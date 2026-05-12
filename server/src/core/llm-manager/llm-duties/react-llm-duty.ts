import fs from 'node:fs'
import path from 'node:path'

import type { ChatHistoryItem, LlamaContext, LlamaChatSession } from 'node-llama-cpp'

import {
  DEFAULT_INIT_PARAMS,
  LLMDuty,
  type LLMDutyInitParams,
  type LLMDutyParams,
  type LLMDutyResult
} from '@/core/llm-manager/llm-duty'
import { LogHelper } from '@/helpers/log-helper'
import { StringHelper } from '@/helpers/string-helper'
import {
  LLM_MANAGER,
  LLM_PROVIDER,
  PERSONA,
  TOOLKIT_REGISTRY,
  CONTEXT_MANAGER,
  SELF_MODEL_MANAGER,
  CONVERSATION_LOGGER,
  BRAIN,
  SOCKET_SERVER
} from '@/core'
import {
  LLMDuties,
  LLMProviders,
  type LLMReasoningMode,
  type LLMPromptAbortReason,
  type OpenAITool,
  type OpenAIToolCall,
  type OpenAIToolChoice
} from '@/core/llm-manager/types'
import { ContextStateStore } from '@/core/context-manager/context-state-store'
import { PROFILE_LOGS_PATH } from '@/constants'
import type { MessageLog } from '@/types'
import { ConversationHistoryHelper } from '@/helpers/conversation-history-helper'
import { CONFIG_STATE } from '@/core/config-states/config-state'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'
import { getActiveConversationSessionId } from '@/core/session-manager/session-context'

function getLLMProviderName(): LLMProviders {
  return CONFIG_STATE.getModelState().getAgentProvider()
}

import {
  PLAN_SYSTEM_PROMPT,
  REACT_TEMPERATURE,
  REACT_INFERENCE_TIMEOUT_MS,
  REACT_TIMEOUT_MAX_RETRIES,
  CHARS_PER_TOKEN,
  TOOL_CALL_WAIT_NOTICE_DELAY_MS,
  TOOL_CALL_DIAGNOSIS_DELAY_MS,
  TOOL_CALL_DIAGNOSIS_RETRY_DELAY_MS,
  REACT_HISTORY_COMPACTION_MAX_TOKENS,
  REACT_HISTORY_COMPACTION_RETRY_MAX_TOKENS,
  REACT_HISTORY_COMPACTION_SYSTEM_PROMPT,
  REACT_LOCAL_PROVIDER_HISTORY_LOGS,
  REACT_LOCAL_PROVIDER_HISTORY_COMPACTION_POINT,
  REACT_REMOTE_PROVIDER_HISTORY_LOGS,
  REACT_REMOTE_PROVIDER_HISTORY_COMPACTION_POINT,
  MAX_EXECUTIONS,
  MAX_REPLANS
} from './react-llm-duty/constants'
import type {
  ReactLLMDutyParams,
  ExecutionRecord,
  PlanStep,
  TrackedPlanStep,
  PlanStepStatus,
  LLMCaller,
  PromptLogSection,
  LLMCallOptions,
  FinalResponseSignal,
  ReactPhase,
  AgentSkillContext
} from './react-llm-duty/types'
import { widgetId, emitPlanWidget } from './react-llm-duty/plan-widget'
import {
  getPhasePolicy,
  formatPhasePolicyForLog
} from './react-llm-duty/phase-policy'
import {
  buildCatalog,
  runPlanningPhase,
  runRecoveryPlanningPhase,
  runExecutionSelfObservationPhase,
  runExecutionStep,
  runFinalAnswerPhase
} from './react-llm-duty/phases'
import {
  buildCompactedHistoryMessage,
  findMessageSequenceStart,
  formatHistoryForCompaction,
  hasHistoryCompactionContent,
  normalizeHistoryCompactionSummary,
  toChatHistoryItems
} from './react-llm-duty/history-compaction'
import {
  type AccumulatedLLMMetricsState,
  type FinalAnswerMetricsSnapshot,
  type RawPhaseMetrics,
  deriveLLMMetrics,
  observeCompletionMetrics
} from './react-llm-duty/metrics'
import {
  buildPausedTrackedSteps,
  buildResumedExecutionInput,
  createExecutionContinuationState,
  createIntermediateAnswerExecutionRecord,
  isExecutionContinuationStateValid,
  shouldContinueAfterIntermediateAnswerHandoff,
  type ReactExecutionContinuationPayload,
  type ReactExecutionContinuationState
} from './react-llm-duty/human-in-the-loop'

const REACT_CONTINUATION_STATE_FILENAME = '.react-execution-continuation-state.json'
const REACT_HISTORY_COMPACTION_STATE_FILENAME =
  '.react-history-compaction-state.json'
const REACT_SESSION_STATE_FILENAME_SEPARATOR = '--'
const REACT_PROMPTS_LOG_DIR = path.join(PROFILE_LOGS_PATH, 'prompts')
const LOCAL_REACT_MIN_REASONING_PHASES = new Set<ReactPhase>([
  'execution',
  'recovery'
])
const REPEATED_EXECUTION_LOOP_THRESHOLD = 2

function isLocalAgentProvider(): boolean {
  return [LLMProviders.Local, LLMProviders.LlamaCPP].includes(
    getLLMProviderName()
  )
}

function getEffectiveReasoningMode(
  phase: ReactPhase,
  requestedMode: LLMReasoningMode
): LLMReasoningMode {
  if (!isLocalAgentProvider()) {
    return requestedMode
  }

  if (LOCAL_REACT_MIN_REASONING_PHASES.has(phase)) {
    return 'off'
  }

  if (phase === 'planning' && requestedMode === 'on') {
    return 'guarded'
  }

  return requestedMode
}

function getExecutionLoopSignature(execution: ExecutionRecord): string {
  return JSON.stringify({
    function: execution.function,
    status: execution.status,
    requestedToolInput: execution.requestedToolInput || '',
    observation: String(execution.observation || '').slice(0, 1_000)
  })
}

function countRecentRepeatedExecutions(
  executionHistory: ExecutionRecord[],
  execution: ExecutionRecord
): number {
  const signature = getExecutionLoopSignature(execution)
  let count = 0

  for (const historyItem of [...executionHistory].reverse()) {
    if (getExecutionLoopSignature(historyItem) !== signature) {
      break
    }
    count += 1
  }

  return count
}

type ReactHistoryCompactionScope = 'local' | 'remote'

interface PreparedReactHistory {
  messageLogs: MessageLog[]
  localChatHistory?: ChatHistoryItem[]
}

function emitAgentSkillActivityToWebApp(
  agentSkillContext: AgentSkillContext
): void {
  const skillGroupId =
    `react_agent_skill_${agentSkillContext.id}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

  SOCKET_SERVER.emitAnswerToChatClients({
    answer: `Using Agent Skill: ${agentSkillContext.name}\nFollowing: ${agentSkillContext.skillPath}`,
    isToolOutput: true,
    toolDisplayMode: 'activity_card',
    activityType: 'agent_skill',
    status: 'selected',
    toolGroupId: skillGroupId,
    key: `agent_skill.${agentSkillContext.id}.selected`,
    agentSkill: {
      id: agentSkillContext.id,
      name: agentSkillContext.name,
      description: agentSkillContext.description,
      rootPath: agentSkillContext.rootPath,
      skillPath: agentSkillContext.skillPath
    }
  })
}

interface ReactHistoryCompactionProviderState {
  summary: string | null
  summarySentAt: number | null
  tail: MessageLog[]
  newMessagesSinceCompaction: number
}

interface ReactHistoryCompactionState {
  version: 1
  local: ReactHistoryCompactionProviderState
  remote: ReactHistoryCompactionProviderState
}

function buildProgressMessageFromSteps(steps: PlanStep[]): string | null {
  const normalizedLabels = steps
    .map((step) => step.label.trim())
    .filter((label) => label.length > 0)

  if (normalizedLabels.length === 0) {
    return null
  }

  if (normalizedLabels.length === 1) {
    return `${normalizedLabels[0]}...`
  }

  return `${normalizedLabels[0]} and ${normalizedLabels[1]}...`
}

interface ReactHistoryCompactionConfig {
  historyLimit: number
  compactionBatchSize: number
}

function createEmptyHistoryCompactionProviderState(): ReactHistoryCompactionProviderState {
  return {
    summary: null,
    summarySentAt: null,
    tail: [],
    newMessagesSinceCompaction: 0
  }
}

const REACT_HISTORY_COMPACTION_STATE_FALLBACK: ReactHistoryCompactionState = {
  version: 1,
  local: createEmptyHistoryCompactionProviderState(),
  remote: createEmptyHistoryCompactionProviderState()
}

export class ReActLLMDuty extends LLMDuty {
  private static instance: ReActLLMDuty
  private static context: LlamaContext = null as unknown as LlamaContext
  private static session: LlamaChatSession =
    null as unknown as LlamaChatSession
  private static readonly continuationStateStores =
    new Map<string, ContextStateStore<ReactExecutionContinuationState | null>>()
  private static readonly historyCompactionStateStores =
    new Map<string, ContextStateStore<ReactHistoryCompactionState>>()
  protected systemPrompt: LLMDutyParams['systemPrompt'] = null
  protected readonly name = 'ReAct LLM Duty'
  protected input: LLMDutyParams['input'] = null
  private totalInputTokens = 0
  private totalOutputTokens = 0
  private totalVisibleOutputTokens = 0
  private totalOutputChars = 0
  private totalGenerationDurationMs = 0
  private phaseMetrics: RawPhaseMetrics = {
    planning: { outputTokens: 0, durationMs: 0 },
    execution: { outputTokens: 0, durationMs: 0 },
    recovery: { outputTokens: 0, durationMs: 0 },
    final_answer: { outputTokens: 0, durationMs: 0 }
  }
  private finalAnswerMetrics: FinalAnswerMetricsSnapshot | null = null

  private executionStartedAt = 0
  private hasStreamedTokenEmission = false
  private hasExplicitMemoryWrite = false
  private reasoningGenerationId: string | null = null
  private finalAnswerPhaseCompleted = false
  private finalResponseIntent: FinalResponseSignal['intent'] = 'answer'
  private lastExecutionHistory: ExecutionRecord[] = []
  private activeAgentSkillContext: AgentSkillContext | null
  private activeForcedToolName: string | null

  constructor(params: ReactLLMDutyParams) {
    super()

    if (!ReActLLMDuty.instance) {
      LogHelper.title(this.name)
      LogHelper.success('New instance')

      ReActLLMDuty.instance = this
    }

    this.input = params.input
    this.activeAgentSkillContext = params.agentSkill || null
    this.activeForcedToolName = params.forcedToolName || null
    this.systemPrompt = PERSONA.getCompactDutySystemPrompt(PLAN_SYSTEM_PROMPT, {
      includePersonality: false,
      includeMood: false
    })
  }

  public async init(
    params: LLMDutyInitParams = DEFAULT_INIT_PARAMS
  ): Promise<void> {
    if (!TOOLKIT_REGISTRY.isLoaded) {
      await TOOLKIT_REGISTRY.load()
    }

    if (!CONTEXT_MANAGER.isLoaded || params.force) {
      await CONTEXT_MANAGER.load()
    }

    if (getLLMProviderName() === LLMProviders.Local) {
      if (!ReActLLMDuty.session || params.force) {
        LogHelper.title(this.name)
        LogHelper.info('Initializing...')

        try {
          if (params.force) {
            if (ReActLLMDuty.context) {
              await ReActLLMDuty.context.dispose()
            }
            if (ReActLLMDuty.session) {
              ReActLLMDuty.session.dispose({ disposeSequence: true })
              LogHelper.info('Session disposed')
            }
          }

          ReActLLMDuty.context = await LLM_MANAGER.model.createContext()

          const { LlamaChatSession } = await Function(
            'return import("node-llama-cpp")'
          )()

          ReActLLMDuty.session = new LlamaChatSession({
            contextSequence: ReActLLMDuty.context.getSequence(),
            autoDisposeSequence: true,
            systemPrompt: this.systemPrompt as string
          })

          LogHelper.success('Initialized')
        } catch (e) {
          LogHelper.title(this.name)
          LogHelper.error(`Failed to initialize: ${e}`)
        }
      }
    }
  }

  public async execute(): Promise<LLMDutyResult | null> {
    LogHelper.title(this.name)
    LogHelper.info('Executing...')

    this.executionStartedAt = Date.now()
    this.totalInputTokens = 0
    this.totalOutputTokens = 0
    this.totalVisibleOutputTokens = 0
    this.totalOutputChars = 0
    this.totalGenerationDurationMs = 0
    this.phaseMetrics = {
      planning: { outputTokens: 0, durationMs: 0 },
      execution: { outputTokens: 0, durationMs: 0 },
      recovery: { outputTokens: 0, durationMs: 0 },
      final_answer: { outputTokens: 0, durationMs: 0 }
    }
    this.finalAnswerMetrics = null
    this.hasStreamedTokenEmission = false
    this.hasExplicitMemoryWrite = false
    this.reasoningGenerationId = StringHelper.random(6, { onlyLetters: true })
    this.finalAnswerPhaseCompleted = false
    this.finalResponseIntent = 'answer'
    this.lastExecutionHistory = []

    try {
      const { messageLogs: history, localChatHistory } =
        await this.loadPreparedHistory()

      if (getLLMProviderName() === LLMProviders.Local && localChatHistory) {
        ReActLLMDuty.session.setChatHistory(localChatHistory)
      }

      const ownerInputText = this.getInputAsText(this.input)
      const continuation = this.consumeExecutionContinuation(ownerInputText)
      const effectiveInput = continuation
        ? continuation.resumedInput
        : this.input

      // --- Build adaptive catalog ---
      const catalog = buildCatalog()

      LogHelper.title(this.name)
      LogHelper.debug(`Catalog mode: ${catalog.mode} | Catalog length: ${catalog.text.length} chars (~${Math.ceil(catalog.text.length / 4)} tokens) | Input: "${this.input}"`)
      LogHelper.debug(`Native tools supported: ${this.supportsNativeTools} (provider: ${getLLMProviderName()})`)
      if (continuation) {
        LogHelper.debug(
          `Resuming paused execution from clarification: "${continuation.state.clarificationQuestion}"`
        )
      }

      const planWidgetIdValue = continuation?.state.planWidgetId || widgetId('plan')
      let hasPlanningWidget = false
      const executionHistory: ExecutionRecord[] = []
      let replanCount = 0
      let executionCount = 0
      let pendingSteps: PlanStep[] = []
      let trackedSteps: TrackedPlanStep[] = []
      let currentStepIndex = 0
      let currentExecutingFunction: string | null = null
      let emittedAgentSkillActivityId: string | null = null
      const caller = this.createLLMCaller(history, effectiveInput)
      const emitActiveAgentSkillActivity = (): void => {
        const activeAgentSkillContext = caller.agentSkillContext

        if (
          !activeAgentSkillContext ||
          emittedAgentSkillActivityId === activeAgentSkillContext.id
        ) {
          return
        }

        emitAgentSkillActivityToWebApp(activeAgentSkillContext)
        emittedAgentSkillActivityId = activeAgentSkillContext.id
      }
      const finalizeWithPostAnswerMaintenance = async (
        finalAnswer: string,
        finalIntent: FinalResponseSignal['intent'] = 'answer'
      ): Promise<LLMDutyResult> => {
        this.finalAnswerPhaseCompleted = true
        this.finalResponseIntent = finalIntent
        this.lastExecutionHistory = executionHistory.map((item) => ({
          ...item
        }))
        const dutyResult = this.makeDutyResult(finalAnswer)
        try {
          await this.maybeCompactHistoryAfterAnswer(
            planWidgetIdValue,
            trackedSteps
          )
        } catch (error) {
          LogHelper.title(this.name)
          LogHelper.warning(
            `Post-answer history compaction failed: ${String(error)}`
          )
        }
        return dutyResult
      }
      const finalizeFromSignal = async (
        signal: FinalResponseSignal
      ): Promise<LLMDutyResult> => {
        const finalAnswer = await runFinalAnswerPhase(
          caller,
          executionHistory,
          signal
        )
        return finalizeWithPostAnswerMaintenance(finalAnswer, signal.intent)
      }

      if (continuation) {
        pendingSteps = continuation.state.pendingSteps.map((step) => ({
          function: step.function,
          label: step.label,
          ...(step.agentSkillId ? { agentSkillId: step.agentSkillId } : {})
        }))
        executionHistory.push(
          ...continuation.state.executionHistory.map((item) => ({ ...item }))
        )
        replanCount = continuation.state.replanCount
        executionCount = continuation.state.executionCount
        trackedSteps = continuation.state.trackedSteps.map((step) => ({
          label: step.label,
          status: step.status
        }))

        if (trackedSteps.length === 0) {
          trackedSteps = pendingSteps.map((step, index) => ({
            label: step.label,
            status: index === 0 ? 'in_progress' : 'pending'
          }))
          currentStepIndex = 0
        } else {
          currentStepIndex = Math.min(
            Math.max(continuation.state.currentStepIndex, 0),
            Math.max(trackedSteps.length - 1, 0)
          )
          trackedSteps = buildPausedTrackedSteps(
            trackedSteps,
            currentStepIndex
          )
        }

        emitPlanWidget(trackedSteps, null, planWidgetIdValue, true)
        hasPlanningWidget = true
      } else if (this.activeForcedToolName) {
        const forcedToolStep = this.getForcedToolPlanStep()

        if (!forcedToolStep) {
          const unsupportedToolSignal: FinalResponseSignal = {
            intent: 'error',
            draft: `The tool "${this.activeForcedToolName}" is not available.`,
            source: 'system'
          }

          return await finalizeFromSignal(unsupportedToolSignal)
        }

        pendingSteps = [forcedToolStep]
        trackedSteps = [
          {
            label: forcedToolStep.label,
            status: 'in_progress' as PlanStepStatus
          }
        ]

        emitPlanWidget(trackedSteps, null, planWidgetIdValue, false)
        hasPlanningWidget = true
      } else {
        // --- Phase 1: Planning ---
        this.logTitle('planning')
        LogHelper.debug('Phase 1: Planning...')

        let planningUiSteps: TrackedPlanStep[] = [
          { label: 'Thinking...', status: 'in_progress' }
        ]
        emitPlanWidget(
          planningUiSteps,
          null,
          planWidgetIdValue,
          false
        )
        hasPlanningWidget = true

        const updatePlanningStage = (): void => {
          planningUiSteps = [
            { label: 'Thinking...', status: 'in_progress' }
          ]
          if (hasPlanningWidget) {
            emitPlanWidget(
              planningUiSteps,
              null,
              planWidgetIdValue,
              true
            )
          }
        }

        const planResult = await runPlanningPhase(
          caller,
          catalog,
          history,
          updatePlanningStage
        )
        emitActiveAgentSkillActivity()

        if (planResult.type === 'handoff') {
          if (hasPlanningWidget) {
            emitPlanWidget(
              planningUiSteps.map((step) => ({ ...step, status: 'completed' })),
              null,
              planWidgetIdValue,
              true
            )
          }
          this.logTitle('planning')
          LogHelper.debug(
            `Planning returned handoff signal: intent="${planResult.signal.intent}"`
          )
          return await finalizeFromSignal(planResult.signal)
        }

        this.logTitle('planning')
        LogHelper.debug(
          `Plan created with ${planResult.steps.length} step(s): ${planResult.steps.map((s) => s.function).join(' -> ')}`
        )
        if (planResult.summary) {
          LogHelper.debug(`Plan summary: "${planResult.summary}"`)
        }

        pendingSteps = [...planResult.steps]

        // --- Plan widget state ---
        trackedSteps = pendingSteps.map((s) => ({
          label: s.label,
          status: 'pending' as PlanStepStatus
        }))

        // Mark first step as in_progress and emit initial widget
        if (trackedSteps.length > 0) {
          trackedSteps[0]!.status = 'in_progress'
        }

        // Emit plan summary as text, then show the widget
        const planningProgressMessage =
          planResult.summary ||
          buildProgressMessageFromSteps(planResult.steps)
        if (planningProgressMessage) {
          await this.emitProgress(
            this.toProgressiveMessage(planningProgressMessage)
          )
        }
        emitPlanWidget(
          trackedSteps,
          null,
          planWidgetIdValue,
          hasPlanningWidget
        )
        hasPlanningWidget = true
      }

      // --- Phase 2: Execution loop ---
      this.logTitle('execution')
      LogHelper.debug('Phase 2: Execution loop...')

      while (pendingSteps.length > 0 && executionCount < MAX_EXECUTIONS) {
        const currentStep = pendingSteps.shift()!
        executionCount += 1
        currentExecutingFunction = currentStep.function

        emitPlanWidget(
          trackedSteps,
          null,
          planWidgetIdValue,
          true,
          currentExecutingFunction
        )

        LogHelper.title(this.name)
        LogHelper.debug(
          `Execution ${executionCount}/${MAX_EXECUTIONS}: ${currentStep.function} | label="${currentStep.label}" | ${pendingSteps.length} step(s) remaining`
        )

        const stepResult = await runExecutionStep(
          caller,
          currentStep,
          executionHistory,
          catalog
        )

        if (stepResult.type === 'handoff') {
          LogHelper.title(this.name)
          LogHelper.debug(
            `Execution returned handoff signal: intent="${stepResult.signal.intent}"`
          )

          if (stepResult.signal.intent === 'clarification') {
            const pausedTrackedSteps = buildPausedTrackedSteps(
              trackedSteps,
              currentStepIndex
            )
            this.pauseExecutionForClarification({
              planWidgetId: planWidgetIdValue,
              originalInput:
                continuation?.state.originalInput || ownerInputText,
              clarificationQuestion: stepResult.signal.draft,
              currentStep,
              pendingSteps,
              executionHistory,
              trackedSteps: pausedTrackedSteps,
              currentStepIndex,
              replanCount,
              executionCount
            })
            currentExecutingFunction = null
            emitPlanWidget(
              pausedTrackedSteps,
              null,
              planWidgetIdValue,
              true,
              currentExecutingFunction
            )

            LogHelper.debug(
              `Execution paused for clarification at step "${currentStep.label}"`
            )
            return await finalizeFromSignal(stepResult.signal)
          }

          if (
            shouldContinueAfterIntermediateAnswerHandoff(
              stepResult.signal,
              pendingSteps
            )
          ) {
            LogHelper.debug(
              `Continuing after intermediate answer handoff; ${pendingSteps.length} pending step(s) remain`
            )
            executionHistory.push(
              createIntermediateAnswerExecutionRecord(
                currentStep,
                stepResult.signal
              )
            )

            if (currentStepIndex < trackedSteps.length) {
              trackedSteps[currentStepIndex]!.status = 'completed'
            }
            const nextTrackedIndex = currentStepIndex + 1
            if (nextTrackedIndex < trackedSteps.length) {
              trackedSteps[nextTrackedIndex]!.status = 'in_progress'
            }
            currentExecutingFunction = null
            emitPlanWidget(
              trackedSteps,
              currentStepIndex,
              planWidgetIdValue,
              true,
              currentExecutingFunction
            )
            currentStepIndex = nextTrackedIndex
            continue
          }

          // Mark all remaining steps as completed in the widget
          for (const ts of trackedSteps) {
            ts.status = 'completed'
          }
          currentExecutingFunction = null
          emitPlanWidget(
            trackedSteps,
            null,
            planWidgetIdValue,
            true,
            currentExecutingFunction
          )

          return await finalizeFromSignal(stepResult.signal)
        }

        if (stepResult.type === 'replan') {
          replanCount += 1
          LogHelper.title(this.name)
          LogHelper.debug(
            `Re-plan ${replanCount}/${MAX_REPLANS}: reason="${stepResult.reason}" | new steps: ${stepResult.steps.map((step) => step.function).join(' -> ')}`
          )

          if (replanCount > MAX_REPLANS) {
            LogHelper.title(this.name)
            LogHelper.warning('Max re-plans reached, synthesizing answer')
            break
          }

          pendingSteps = stepResult.steps.map((step) => ({
            function: step.function,
            label: step.label,
            ...(step.agentSkillId ? { agentSkillId: step.agentSkillId } : {})
          }))

          // Rebuild tracked steps: keep completed ones, replace remaining
          const completedSteps = trackedSteps.filter(
            (s) => s.status === 'completed'
          )
          const newSteps: TrackedPlanStep[] = pendingSteps.map((s) => ({
            label: s.label,
            status: 'pending' as PlanStepStatus
          }))
          if (newSteps.length > 0) {
            newSteps[0]!.status = 'in_progress'
          }
          trackedSteps = [...completedSteps, ...newSteps]
          currentStepIndex = completedSteps.length

          currentExecutingFunction = null
          emitPlanWidget(
            trackedSteps,
            null,
            planWidgetIdValue,
            true,
            currentExecutingFunction
          )
          continue
        }

        // Record execution
        const repeatedExecutionCount = countRecentRepeatedExecutions(
          executionHistory,
          stepResult.execution
        )
        executionHistory.push(stepResult.execution)

        if (repeatedExecutionCount >= REPEATED_EXECUTION_LOOP_THRESHOLD) {
          LogHelper.title(this.name)
          LogHelper.warning(
            `Execution loop detected after ${repeatedExecutionCount + 1} repeated "${stepResult.execution.function}" result(s)`
          )
          if (currentStepIndex < trackedSteps.length) {
            trackedSteps[currentStepIndex]!.status =
              stepResult.execution.status === 'error' ? 'error' : 'completed'
          }
          currentExecutingFunction = null
          emitPlanWidget(
            trackedSteps,
            null,
            planWidgetIdValue,
            true,
            currentExecutingFunction
          )

          return await finalizeFromSignal({
            intent:
              stepResult.execution.status === 'error' ? 'error' : 'blocked',
            draft:
              'Execution stopped because the same tool result repeated without new progress. Summarize the repeated observation and explain the next concrete input or setup needed.',
            source: 'execution'
          })
        }

        if (
          stepResult.execution.status === 'success' &&
          stepResult.execution.function ===
            'structured_knowledge.memory.write'
        ) {
          this.hasExplicitMemoryWrite = true
        }

        LogHelper.title(this.name)
        LogHelper.debug(
          `Execution result: ${stepResult.execution.function} [${stepResult.execution.status}]`
        )
        LogHelper.debug(`Observation: ${stepResult.execution.observation}`)

        // Check for short-circuit handoff from tool result
        if (stepResult.handoffSignal) {
          LogHelper.title(this.name)
          LogHelper.debug(
            `Tool returned handoff signal: intent="${stepResult.handoffSignal.intent}"`
          )

          if (stepResult.handoffSignal.intent === 'clarification') {
            const pausedTrackedSteps = buildPausedTrackedSteps(
              trackedSteps,
              currentStepIndex
            )
            this.pauseExecutionForClarification({
              planWidgetId: planWidgetIdValue,
              originalInput:
                continuation?.state.originalInput || ownerInputText,
              clarificationQuestion: stepResult.handoffSignal.draft,
              currentStep,
              pendingSteps,
              executionHistory,
              trackedSteps: pausedTrackedSteps,
              currentStepIndex,
              replanCount,
              executionCount
            })
            currentExecutingFunction = null
            emitPlanWidget(
              pausedTrackedSteps,
              null,
              planWidgetIdValue,
              true,
              currentExecutingFunction
            )

            LogHelper.debug(
              `Execution paused for clarification at step "${currentStep.label}"`
            )
            return await finalizeFromSignal(stepResult.handoffSignal)
          }

          if (
            shouldContinueAfterIntermediateAnswerHandoff(
              stepResult.handoffSignal,
              pendingSteps
            )
          ) {
            LogHelper.debug(
              `Continuing after intermediate tool answer handoff; ${pendingSteps.length} pending step(s) remain`
            )
          } else {
            if (
              stepResult.execution.status === 'error' &&
              currentStepIndex < trackedSteps.length
            ) {
              trackedSteps[currentStepIndex]!.status = 'error'
            } else {
              // Mark all remaining as completed
              for (const ts of trackedSteps) {
                ts.status = 'completed'
              }
            }
            currentExecutingFunction = null
            emitPlanWidget(
              trackedSteps,
              null,
              planWidgetIdValue,
              true,
              currentExecutingFunction
            )

            return await finalizeFromSignal(stepResult.handoffSignal)
          }
        }

        if (stepResult.execution.status === 'error') {
          if (replanCount >= MAX_REPLANS) {
            LogHelper.title(this.name)
            LogHelper.warning(
              'Recovery replanning skipped: max re-plans reached'
            )
            if (currentStepIndex < trackedSteps.length) {
              trackedSteps[currentStepIndex]!.status = 'error'
            }
            currentExecutingFunction = null
            emitPlanWidget(
              trackedSteps,
              null,
              planWidgetIdValue,
              true,
              currentExecutingFunction
            )

            return await finalizeFromSignal({
              intent: 'error',
              draft:
                'The task failed after exhausting recovery attempts. Summarize the failed tool observation and what input or setup is needed next.',
              source: 'recovery'
            })
          }

          let recoveryPlanResult = null
          try {
            recoveryPlanResult = await runRecoveryPlanningPhase(
              caller,
              catalog,
              history,
              executionHistory,
              currentStep,
              pendingSteps
            )
          } catch (error) {
            LogHelper.title(this.name)
            LogHelper.error(`Recovery planning failed: ${error}`)
            if (currentStepIndex < trackedSteps.length) {
              trackedSteps[currentStepIndex]!.status = 'error'
            }
            currentExecutingFunction = null
            emitPlanWidget(
              trackedSteps,
              null,
              planWidgetIdValue,
              true,
              currentExecutingFunction
            )

            return await finalizeFromSignal({
              intent: 'error',
              draft: `Recovery planning failed after the tool error: ${
                (error as Error).message || String(error)
              }`,
              source: 'recovery'
            })
          }

          if (recoveryPlanResult?.type === 'handoff') {
            LogHelper.title(this.name)
            LogHelper.debug(
              `Recovery planning returned handoff signal: intent="${recoveryPlanResult.signal.intent}"`
            )

            if (recoveryPlanResult.signal.intent === 'clarification') {
              const retryStepIndex = currentStepIndex
              const pausedTrackedSteps =
                trackedSteps.length > 0
                  ? buildPausedTrackedSteps(trackedSteps, retryStepIndex)
                  : [
                      {
                        label: currentStep.label,
                        status: 'in_progress' as PlanStepStatus
                      }
                    ]
              const pendingWithCurrent: PlanStep[] = [currentStep, ...pendingSteps]

              this.saveExecutionContinuation({
                version: 1,
                phase: 'execution',
                planWidgetId: planWidgetIdValue,
                originalInput:
                  continuation?.state.originalInput || ownerInputText,
                clarificationQuestion: recoveryPlanResult.signal.draft,
                pendingSteps: pendingWithCurrent,
                executionHistory,
                trackedSteps: pausedTrackedSteps,
                currentStepIndex:
                  pausedTrackedSteps.length > 0
                    ? Math.min(retryStepIndex, pausedTrackedSteps.length - 1)
                    : 0,
                replanCount,
                executionCount,
                createdAt: Date.now()
              })
              currentExecutingFunction = null
              emitPlanWidget(
                pausedTrackedSteps,
                null,
                planWidgetIdValue,
                true,
                currentExecutingFunction
              )

              LogHelper.debug(
                `Recovery execution paused for clarification at step "${currentStep.label}"`
              )
              return await finalizeFromSignal(recoveryPlanResult.signal)
            }

            return await finalizeFromSignal(recoveryPlanResult.signal)
          }

          if (
            recoveryPlanResult?.type === 'plan' &&
            recoveryPlanResult.steps.length > 0
          ) {
            replanCount += 1
            pendingSteps = [...recoveryPlanResult.steps]

            LogHelper.title(this.name)
            LogHelper.debug(
              `Recovery re-plan ${replanCount}/${MAX_REPLANS}: ${pendingSteps.map((s) => s.function).join(' -> ')}`
            )
            const recoveryProgressMessage =
              recoveryPlanResult.summary ||
              buildProgressMessageFromSteps(recoveryPlanResult.steps)
            if (recoveryProgressMessage) {
              if (recoveryPlanResult.summary) {
                LogHelper.debug(
                  `Recovery plan summary: "${recoveryPlanResult.summary}"`
                )
              }
              await this.emitProgress(
                this.toProgressiveMessage(recoveryProgressMessage)
              )
            }

            const completedSteps = trackedSteps
              .slice(0, currentStepIndex)
              .filter((s) => s.status === 'completed')
            const newSteps: TrackedPlanStep[] = pendingSteps.map((s) => ({
              label: s.label,
              status: 'pending' as PlanStepStatus
            }))
            if (newSteps.length > 0) {
              newSteps[0]!.status = 'in_progress'
            }
            trackedSteps = [...completedSteps, ...newSteps]
            currentStepIndex = completedSteps.length

            currentExecutingFunction = null
            emitPlanWidget(
              trackedSteps,
              null,
              planWidgetIdValue,
              true,
              currentExecutingFunction
            )
            continue
          }

          if (currentStepIndex < trackedSteps.length) {
            trackedSteps[currentStepIndex]!.status = 'error'
          }
          currentExecutingFunction = null
          emitPlanWidget(
            trackedSteps,
            null,
            planWidgetIdValue,
            true,
            currentExecutingFunction
          )

          return await finalizeFromSignal({
            intent: 'error',
            draft:
              'The tool step failed and recovery could not find another executable path. Explain the failure from execution history and ask for the missing artifact or configuration needed to continue.',
            source: 'recovery'
          })
        }

        // Update plan widget after a successful step: mark current step as completed,
        // then move the next step to in_progress.
        if (currentStepIndex < trackedSteps.length) {
          trackedSteps[currentStepIndex]!.status = 'completed'
        }
        const nextTrackedIndex = currentStepIndex + 1
        if (nextTrackedIndex < trackedSteps.length) {
          trackedSteps[nextTrackedIndex]!.status = 'in_progress'
        }
        currentExecutingFunction = null
        emitPlanWidget(
          trackedSteps,
          currentStepIndex,
          planWidgetIdValue,
          true,
          currentExecutingFunction
        )
        currentStepIndex = nextTrackedIndex

        if (
          stepResult.execution.status === 'success' &&
          pendingSteps.length === 0
        ) {
          if (replanCount >= MAX_REPLANS) {
            LogHelper.title(this.name)
            LogHelper.warning(
              'Execution self-observation replanning skipped: max re-plans reached'
            )
            continue
          }

          const selfObservationResult = await runExecutionSelfObservationPhase(
            caller,
            executionHistory
          )

          if (selfObservationResult?.type === 'handoff') {
            LogHelper.title(this.name)
            LogHelper.debug(
              `Execution self-observation returned handoff signal: intent="${selfObservationResult.signal.intent}"`
            )

            return await finalizeFromSignal(selfObservationResult.signal)
          }

          if (
            selfObservationResult?.type === 'replan' &&
            selfObservationResult.steps.length > 0
          ) {
            replanCount += 1
            pendingSteps = selfObservationResult.steps.map((step) => ({
              function: step.function,
              label: step.label,
              ...(step.agentSkillId ? { agentSkillId: step.agentSkillId } : {})
            }))

            LogHelper.title(this.name)
            LogHelper.debug(
              `Execution self-observation re-plan ${replanCount}/${MAX_REPLANS}: ${pendingSteps.map((s) => s.function).join(' -> ')}`
            )
            if (selfObservationResult.reason) {
              LogHelper.debug(
                `Execution self-observation reason: "${selfObservationResult.reason}"`
              )
              const normalizedReason = selfObservationResult.reason
                .trim()
                .replace(/[.?!]+$/g, '')
              await this.emitProgress(
                normalizedReason ? `${normalizedReason}...` : 'Working...'
              )
            }

            const appendStartIndex = trackedSteps.length
            const appendedSteps: TrackedPlanStep[] = pendingSteps.map((s) => ({
              label: s.label,
              status: 'pending' as PlanStepStatus
            }))
            if (appendedSteps.length > 0) {
              appendedSteps[0]!.status = 'in_progress'
            }
            trackedSteps = [...trackedSteps, ...appendedSteps]
            currentStepIndex = appendStartIndex

            currentExecutingFunction = null
            emitPlanWidget(
              trackedSteps,
              null,
              planWidgetIdValue,
              true,
              currentExecutingFunction
            )
            continue
          }
        }
      }

      // --- Phase 3: Final answer synthesis ---
      this.logTitle('final_answer')
      LogHelper.debug(`Phase 3: Final answer synthesis (${executionHistory.length} execution(s) completed)`)

      // Mark all steps as completed in the widget
      for (const ts of trackedSteps) {
        ts.status = 'completed'
      }
      currentExecutingFunction = null
      emitPlanWidget(
        trackedSteps,
        null,
        planWidgetIdValue,
        true,
        currentExecutingFunction
      )

      if (executionHistory.length === 0) {
        LogHelper.debug('No executions completed, handing off to final phase')
        const providerError = LLM_PROVIDER.consumeLastProviderErrorMessage()
        const noExecutionSignal: FinalResponseSignal = providerError
          ? {
              intent: 'error',
              draft: providerError,
              source: 'system'
            }
          : {
              intent: 'error',
              draft: 'I was unable to find the right tools to help with your request.',
              source: 'system'
            }
        return await finalizeFromSignal(noExecutionSignal)
      }

      const finalAnswer = await runFinalAnswerPhase(caller, executionHistory)
      return await finalizeWithPostAnswerMaintenance(finalAnswer, 'answer')
    } catch (e) {
      LogHelper.title(this.name)
      LogHelper.error(`Failed to execute: ${e}`)
    }

    return null
  }

  private getForcedToolPlanStep(): PlanStep | null {
    if (!this.activeForcedToolName) {
      return null
    }

    const resolvedTool = TOOLKIT_REGISTRY.resolveToolById(
      this.activeForcedToolName
    )

    if (!resolvedTool) {
      return null
    }

    return {
      function: `${resolvedTool.toolkitId}.${resolvedTool.toolId}`,
      label: `Use ${resolvedTool.toolName}`
    }
  }

  private async loadPreparedHistory(): Promise<PreparedReactHistory> {
    const historyConfig = this.getHistoryCompactionConfig()
    const historyScope = this.getHistoryCompactionScope()
    const conversationLogs = this.getHistoryEligibleConversationLogs(
      await CONVERSATION_LOGGER.loadAll()
    )
    const currentState = this.loadHistoryCompactionProviderState(historyScope)
    const synchronizedState = this.synchronizeHistoryCompactionState(
      conversationLogs,
      currentState
    )

    if (synchronizedState.shouldPersist) {
      this.saveHistoryCompactionProviderState(historyScope, synchronizedState.state)
    }

    return this.buildPreparedHistory(
      this.buildHistoryForCurrentTurn(
        conversationLogs,
        synchronizedState.state,
        historyConfig
      )
    )
  }

  private getHistoryCompactionScope(): ReactHistoryCompactionScope {
    return getLLMProviderName() === LLMProviders.Local ? 'local' : 'remote'
  }

  private getHistoryCompactionConfig(): ReactHistoryCompactionConfig {
    if (getLLMProviderName() === LLMProviders.Local) {
      return {
        historyLimit: REACT_LOCAL_PROVIDER_HISTORY_LOGS,
        compactionBatchSize: REACT_LOCAL_PROVIDER_HISTORY_COMPACTION_POINT
      }
    }

    return {
      historyLimit: REACT_REMOTE_PROVIDER_HISTORY_LOGS,
      compactionBatchSize: REACT_REMOTE_PROVIDER_HISTORY_COMPACTION_POINT
    }
  }

  private getSessionStateFilename(filename: string): string {
    const sessionId = getActiveConversationSessionId()

    if (!sessionId) {
      return filename
    }

    return `${filename}${REACT_SESSION_STATE_FILENAME_SEPARATOR}${sessionId}`
  }

  private getContinuationStateStore(): ContextStateStore<ReactExecutionContinuationState | null> {
    const filename = this.getSessionStateFilename(REACT_CONTINUATION_STATE_FILENAME)
    const existingStore = ReActLLMDuty.continuationStateStores.get(filename)

    if (existingStore) {
      return existingStore
    }

    const store = new ContextStateStore<ReactExecutionContinuationState | null>(
      filename,
      null
    )

    ReActLLMDuty.continuationStateStores.set(filename, store)

    return store
  }

  private getHistoryCompactionStateStore(): ContextStateStore<ReactHistoryCompactionState> {
    const filename = this.getSessionStateFilename(
      REACT_HISTORY_COMPACTION_STATE_FILENAME
    )
    const existingStore = ReActLLMDuty.historyCompactionStateStores.get(filename)

    if (existingStore) {
      return existingStore
    }

    const store = new ContextStateStore<ReactHistoryCompactionState>(
      filename,
      REACT_HISTORY_COMPACTION_STATE_FALLBACK
    )

    ReActLLMDuty.historyCompactionStateStores.set(filename, store)

    return store
  }

  private getHistoryEligibleConversationLogs(
    conversationLogs: MessageLog[]
  ): MessageLog[] {
    return conversationLogs.filter(
      (conversationLog) => ConversationHistoryHelper.isAddedToHistory(conversationLog)
    )
  }

  private loadHistoryCompactionProviderState(
    scope: ReactHistoryCompactionScope
  ): ReactHistoryCompactionProviderState {
    const persistedState = this.getHistoryCompactionStateStore().load()
    return this.normalizeHistoryCompactionProviderState(persistedState?.[scope])
  }

  private normalizeHistoryCompactionProviderState(
    value: unknown
  ): ReactHistoryCompactionProviderState {
    const record =
      value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : null

    return {
      summary: normalizeHistoryCompactionSummary(record?.['summary']),
      summarySentAt:
        typeof record?.['summarySentAt'] === 'number'
          ? record['summarySentAt']
          : null,
      newMessagesSinceCompaction:
        typeof record?.['newMessagesSinceCompaction'] === 'number' &&
        Number.isFinite(record['newMessagesSinceCompaction']) &&
        record['newMessagesSinceCompaction'] >= 0
          ? Math.floor(record['newMessagesSinceCompaction'])
          : 0,
      tail: this.normalizeMessageLogs(record?.['tail'])
    }
  }

  private saveHistoryCompactionProviderState(
    scope: ReactHistoryCompactionScope,
    providerState: ReactHistoryCompactionProviderState
  ): void {
    const persistedState = this.getHistoryCompactionStateStore().load()
    const nextState: ReactHistoryCompactionState = {
      version: 1,
      local:
        scope === 'local'
          ? providerState
          : this.normalizeHistoryCompactionProviderState(persistedState?.local),
      remote:
        scope === 'remote'
          ? providerState
          : this.normalizeHistoryCompactionProviderState(persistedState?.remote)
    }

    this.getHistoryCompactionStateStore().save(nextState)
  }

  private normalizeMessageLogs(value: unknown): MessageLog[] {
    if (!Array.isArray(value)) {
      return []
    }

    return value.flatMap((item) => {
      const record =
        item && typeof item === 'object'
          ? (item as Record<string, unknown>)
          : null

      if (
        !record ||
        (record['who'] !== 'owner' && record['who'] !== 'leon') ||
        typeof record['sentAt'] !== 'number' ||
        typeof record['message'] !== 'string'
      ) {
        return []
      }

      return [
        {
          who: record['who'],
          sentAt: record['sentAt'],
          message: record['message'],
          isAddedToHistory:
            typeof record['isAddedToHistory'] === 'boolean'
              ? record['isAddedToHistory']
              : true
        }
      ]
    })
  }

  private hasStoredHistoryCompactionState(
    state: ReactHistoryCompactionProviderState
  ): boolean {
    return Boolean(
      hasHistoryCompactionContent(state.summary) ||
        state.summarySentAt !== null ||
        state.tail.length > 0 ||
        state.newMessagesSinceCompaction > 0
    )
  }

  private areMessageLogsEqual(left: MessageLog[], right: MessageLog[]): boolean {
    if (left.length !== right.length) {
      return false
    }

    return left.every((message, index) => {
      const otherMessage = right[index]

      return (
        otherMessage &&
        message.who === otherMessage.who &&
        message.sentAt === otherMessage.sentAt &&
        message.message === otherMessage.message
      )
    })
  }

  private areHistoryCompactionStatesEqual(
    left: ReactHistoryCompactionProviderState,
    right: ReactHistoryCompactionProviderState
  ): boolean {
    return (
      left.summary === right.summary &&
      left.summarySentAt === right.summarySentAt &&
      left.newMessagesSinceCompaction === right.newMessagesSinceCompaction &&
      this.areMessageLogsEqual(left.tail, right.tail)
    )
  }

  private rebuildHistoryCompactionStateFromBoundary(
    conversationLogs: MessageLog[],
    currentState: ReactHistoryCompactionProviderState
  ): ReactHistoryCompactionProviderState {
    if (
      !hasHistoryCompactionContent(currentState.summary) ||
      currentState.summarySentAt === null
    ) {
      return createEmptyHistoryCompactionProviderState()
    }

    const rebuiltTail = conversationLogs.filter(
      (conversationLog) => conversationLog.sentAt > currentState.summarySentAt!
    )

    return {
      summary: currentState.summary,
      summarySentAt: currentState.summarySentAt,
      tail: rebuiltTail,
      newMessagesSinceCompaction: rebuiltTail.length
    }
  }

  private synchronizeHistoryCompactionState(
    conversationLogs: MessageLog[],
    currentState: ReactHistoryCompactionProviderState
  ): {
    state: ReactHistoryCompactionProviderState
    shouldPersist: boolean
  } {
    const emptyState = createEmptyHistoryCompactionProviderState()

    if (!hasHistoryCompactionContent(currentState.summary)) {
      return {
        state: emptyState,
        shouldPersist:
          this.hasStoredHistoryCompactionState(currentState) &&
          !this.areHistoryCompactionStatesEqual(currentState, emptyState)
      }
    }

    if (currentState.tail.length === 0) {
      const rebuiltState = this.rebuildHistoryCompactionStateFromBoundary(
        conversationLogs,
        currentState
      )

      return {
        state: rebuiltState,
        shouldPersist: !this.areHistoryCompactionStatesEqual(
          currentState,
          rebuiltState
        )
      }
    }

    const tailStartIndex = findMessageSequenceStart(conversationLogs, currentState.tail)
    if (tailStartIndex === -1) {
      const rebuiltState = this.rebuildHistoryCompactionStateFromBoundary(
        conversationLogs,
        currentState
      )

      LogHelper.title(this.name)
      LogHelper.debug(
        'History compaction tail mismatch; rebuilding from compaction boundary'
      )

      return {
        state: rebuiltState,
        shouldPersist: !this.areHistoryCompactionStatesEqual(
          currentState,
          rebuiltState
        )
      }
    }

    const synchronizedState: ReactHistoryCompactionProviderState = {
      summary: currentState.summary,
      summarySentAt: currentState.summarySentAt,
      tail: conversationLogs.slice(tailStartIndex),
      newMessagesSinceCompaction:
        currentState.newMessagesSinceCompaction +
        (conversationLogs.length - tailStartIndex - currentState.tail.length)
    }

    return {
      state: synchronizedState,
      shouldPersist: !this.areHistoryCompactionStatesEqual(
        currentState,
        synchronizedState
      )
    }
  }

  private buildHistoryForCurrentTurn(
    conversationLogs: MessageLog[],
    state: ReactHistoryCompactionProviderState,
    config: ReactHistoryCompactionConfig
  ): MessageLog[] {
    if (hasHistoryCompactionContent(state.summary)) {
      return this.buildHistoryFromCompactionState({
        ...state,
        tail: state.tail.slice(-(config.historyLimit - 1))
      })
    }

    return conversationLogs.slice(-config.historyLimit)
  }

  private getStateForPostAnswerCompaction(
    conversationLogs: MessageLog[],
    synchronizedState: ReactHistoryCompactionProviderState
  ): ReactHistoryCompactionProviderState {
    if (hasHistoryCompactionContent(synchronizedState.summary)) {
      return synchronizedState
    }

    return {
      summary: null,
      summarySentAt: null,
      tail: [...conversationLogs],
      newMessagesSinceCompaction: conversationLogs.length
    }
  }

  private async rollHistoryCompactionState(
    state: ReactHistoryCompactionProviderState,
    config: ReactHistoryCompactionConfig
  ): Promise<ReactHistoryCompactionProviderState | null> {
    const hadCompactedSummary = hasHistoryCompactionContent(state.summary)
    let nextSummary = state.summary
    let nextSummarySentAt = state.summarySentAt
    let nextTail = [...state.tail]
    let nextNewMessagesSinceCompaction = state.newMessagesSinceCompaction
    let compactedBatches = 0
    let compactedMessages = 0

    while (
      hadCompactedSummary
        ? nextNewMessagesSinceCompaction >= config.compactionBatchSize
        : nextTail.length >= config.historyLimit
    ) {
      const batch = nextTail.slice(0, config.compactionBatchSize)

      LogHelper.title(this.name)
      LogHelper.debug(
        `History compaction triggering: batch=${batch.length} tail=${nextTail.length} threshold=${
          hadCompactedSummary
            ? config.compactionBatchSize
            : config.historyLimit
        } new_messages=${nextNewMessagesSinceCompaction}`
      )

      const compactedSummary = await this.compactHistoryLogs(batch, nextSummary)

      if (!compactedSummary || !hasHistoryCompactionContent(compactedSummary)) {
        return null
      }

      nextSummary = compactedSummary
      nextSummarySentAt =
        batch[batch.length - 1]?.sentAt ?? nextSummarySentAt ?? Date.now()
      nextTail = nextTail.slice(config.compactionBatchSize)
      if (hadCompactedSummary) {
        nextNewMessagesSinceCompaction = Math.max(
          0,
          nextNewMessagesSinceCompaction - batch.length
        )
      }
      compactedBatches += 1
      compactedMessages += batch.length
    }

    if (compactedBatches > 0) {
      LogHelper.title(this.name)
      LogHelper.debug(
        `History compaction advanced: batches=${compactedBatches} absorbed=${compactedMessages} remaining=${nextTail.length}`
      )
    }

    return {
      summary: nextSummary,
      summarySentAt: nextSummarySentAt,
      tail: nextTail,
      newMessagesSinceCompaction: hadCompactedSummary
        ? nextNewMessagesSinceCompaction
        : 0
    }
  }

  private async maybeCompactHistoryAfterAnswer(
    planWidgetId: string,
    trackedSteps: TrackedPlanStep[]
  ): Promise<void> {
    const historyConfig = this.getHistoryCompactionConfig()
    const historyScope = this.getHistoryCompactionScope()
    const conversationLogs = this.getHistoryEligibleConversationLogs(
      await CONVERSATION_LOGGER.loadAll()
    )
    const currentState = this.loadHistoryCompactionProviderState(historyScope)
    const synchronizedState = this.synchronizeHistoryCompactionState(
      conversationLogs,
      currentState
    )

    if (synchronizedState.shouldPersist) {
      this.saveHistoryCompactionProviderState(historyScope, synchronizedState.state)
    }

    const stateToCompact = this.getStateForPostAnswerCompaction(
      conversationLogs,
      synchronizedState.state
    )

    const shouldCompact = hasHistoryCompactionContent(stateToCompact.summary)
      ? stateToCompact.newMessagesSinceCompaction >=
        historyConfig.compactionBatchSize
      : stateToCompact.tail.length >= historyConfig.historyLimit

    if (!shouldCompact) {
      return
    }

    const compactionWidgetSteps = [
      ...trackedSteps.map((step) => ({ ...step })),
      {
        label: 'Compacting history...',
        status: 'in_progress' as PlanStepStatus
      }
    ]

    emitPlanWidget(compactionWidgetSteps, null, planWidgetId, true, null)

    const compactedState = await this.rollHistoryCompactionState(
      stateToCompact,
      historyConfig
    )

    if (!compactedState) {
      emitPlanWidget(trackedSteps, null, planWidgetId, true, null)
      return
    }

    this.saveHistoryCompactionProviderState(historyScope, compactedState)
    compactionWidgetSteps[compactionWidgetSteps.length - 1]!.status = 'completed'
    emitPlanWidget(compactionWidgetSteps, null, planWidgetId, true, null)
  }

  private buildHistoryFromCompactionState(
    state: ReactHistoryCompactionProviderState
  ): MessageLog[] {
    if (!state.summary || !hasHistoryCompactionContent(state.summary)) {
      return [...state.tail]
    }

    const summaryMessage: MessageLog = {
      who: 'leon',
      sentAt: state.summarySentAt ?? state.tail[0]?.sentAt ?? Date.now(),
      message: buildCompactedHistoryMessage(state.summary),
      isAddedToHistory: true
    }

    return [summaryMessage, ...state.tail]
  }

  private buildPreparedHistory(history: MessageLog[]): PreparedReactHistory {
    if (getLLMProviderName() !== LLMProviders.Local) {
      return {
        messageLogs: history
      }
    }

    const [existingSystemMessage] = ReActLLMDuty.session.getChatHistory()
    const systemMessage: ChatHistoryItem = existingSystemMessage || {
      type: 'system',
      text: this.systemPrompt as string
    }

    return {
      messageLogs: history,
      localChatHistory: [systemMessage, ...toChatHistoryItems(history)]
    }
  }

  private async compactHistoryLogs(
    logsToCompact: MessageLog[],
    previousSummary: string | null
  ): Promise<string | null> {
    if (logsToCompact.length === 0) {
      return null
    }

    const prompt = formatHistoryForCompaction(previousSummary, logsToCompact)
    const baseCompletionParams = {
      dutyType: LLMDuties.ReAct,
      systemPrompt: REACT_HISTORY_COMPACTION_SYSTEM_PROMPT,
      temperature: 0,
      disableThinking: true,
      trackProviderErrors: false
    }

    const maxTokenBudgets = [
      REACT_HISTORY_COMPACTION_MAX_TOKENS,
      REACT_HISTORY_COMPACTION_RETRY_MAX_TOKENS
    ]

    for (const maxTokens of maxTokenBudgets) {
      try {
        let result = null

        if (getLLMProviderName() === LLMProviders.Local) {
          const tempContext = await LLM_MANAGER.model.createContext()
          const { LlamaChatSession } = await Function(
            'return import("node-llama-cpp")'
          )()
          const tempSession = new LlamaChatSession({
            contextSequence: tempContext.getSequence(),
            autoDisposeSequence: true,
            systemPrompt: REACT_HISTORY_COMPACTION_SYSTEM_PROMPT
          })

          try {
            result = await LLM_PROVIDER.prompt(prompt, {
              ...baseCompletionParams,
              session: tempSession,
              maxTokens: Math.min(maxTokens, tempContext.contextSize)
            })
          } finally {
            tempSession.dispose({ disposeSequence: true })
            await tempContext.dispose()
          }
        } else {
          result = await LLM_PROVIDER.prompt(prompt, {
            ...baseCompletionParams,
            maxTokens
          })
        }

        const normalized = normalizeHistoryCompactionSummary(result?.output)
        if (normalized && hasHistoryCompactionContent(normalized)) {
          return normalized
        }

        if (maxTokens !== maxTokenBudgets[maxTokenBudgets.length - 1]) {
          LogHelper.title(this.name)
          LogHelper.warning(
            `History compaction returned invalid structured output; retrying with maxTokens=${REACT_HISTORY_COMPACTION_RETRY_MAX_TOKENS}`
          )
        }
      } catch (error) {
        if (maxTokens === maxTokenBudgets[maxTokenBudgets.length - 1]) {
          LogHelper.title(this.name)
          LogHelper.warning(
            `History compaction failed; using raw history instead: ${String(error)}`
          )
          return null
        }

        LogHelper.title(this.name)
        LogHelper.warning(
          `History compaction attempt failed; retrying with maxTokens=${REACT_HISTORY_COMPACTION_RETRY_MAX_TOKENS}: ${String(error)}`
        )
      }
    }

    return null
  }

  private getInputAsText(input: string | object | null): string {
    if (typeof input === 'string') {
      return input
    }

    if (input === null || input === undefined) {
      return ''
    }

    return this.safeJSONStringify(input)
  }

  private loadValidExecutionContinuationState(): ReactExecutionContinuationState | null {
    const state = this.getContinuationStateStore().load()
    if (!state) {
      return null
    }

    if (!isExecutionContinuationStateValid(state)) {
      this.getContinuationStateStore().save(null)
      return null
    }

    return state
  }

  private loadExecutionContinuation(): ReactExecutionContinuationState | null {
    return this.loadValidExecutionContinuationState()
  }

  private saveExecutionContinuation(state: ReactExecutionContinuationState): void {
    this.getContinuationStateStore().save(state)
  }

  private clearExecutionContinuation(): void {
    this.getContinuationStateStore().save(null)
  }

  private consumeExecutionContinuation(
    ownerReply: string
  ): ReactExecutionContinuationPayload | null {
    const state = this.loadExecutionContinuation()
    if (!state) {
      return null
    }

    this.clearExecutionContinuation()

    const resumedInput = buildResumedExecutionInput(
      state.originalInput,
      state.clarificationQuestion,
      ownerReply
    )

    return { state, resumedInput }
  }

  private pauseExecutionForClarification(params: {
    planWidgetId: string
    originalInput: string
    clarificationQuestion: string
    currentStep: PlanStep
    pendingSteps: PlanStep[]
    executionHistory: ExecutionRecord[]
    trackedSteps: TrackedPlanStep[]
    currentStepIndex: number
    replanCount: number
    executionCount: number
  }): void {
    this.saveExecutionContinuation(createExecutionContinuationState(params))
  }

  // ---------------------------------------------------------------------------
  // LLM calling helpers
  // ---------------------------------------------------------------------------

  /**
   * Whether the current LLM provider supports native OpenAI-style tool calling.
   * All remote providers support the OpenAI-compatible tools API.
   * The local provider (node-llama-cpp) uses a different function calling
   * mechanism and stays on grammar-based JSON mode.
   */
  private get supportsNativeTools(): boolean {
    return getLLMProviderName() !== LLMProviders.Local
  }

  /**
   * Creates an LLMCaller interface that phase functions use to call the LLM
   * without needing a direct reference to this class instance.
   */
  private createLLMCaller(
    history: MessageLog[],
    inputOverride?: string | object | null
  ): LLMCaller {
    const getActiveAgentSkillContext = (): AgentSkillContext | null =>
      this.activeAgentSkillContext
    const setActiveAgentSkillContext = (context: AgentSkillContext): void => {
      this.activeAgentSkillContext = context
    }

    return {
      callLLM: this.callLLM.bind(this),
      callLLMText: this.callLLMText.bind(this),
      callLLMWithTools: this.callLLMWithTools.bind(this),
      supportsNativeTools: this.supportsNativeTools,
      input: inputOverride ?? this.input,
      history,
      get agentSkillContext(): AgentSkillContext | null {
        return getActiveAgentSkillContext()
      },
      agentSkillCatalog: SkillDomainHelper.getAgentSkillCatalogContentSync(),
      setAgentSkillContext: setActiveAgentSkillContext,
      getAgentSkillContext:
        SkillDomainHelper.getAgentSkillExecutionContext.bind(SkillDomainHelper),
      getContextFileContent: CONTEXT_MANAGER.getContextFileContent.bind(
        CONTEXT_MANAGER
      ),
      getContextManifest: CONTEXT_MANAGER.getManifest.bind(CONTEXT_MANAGER),
      getSelfModelSnapshot:
        SELF_MODEL_MANAGER.getSnapshot.bind(SELF_MODEL_MANAGER),
      consumeProviderErrorMessage:
        LLM_PROVIDER.consumeLastProviderErrorMessage.bind(LLM_PROVIDER)
    }
  }

  private async withLocalPromptSession<T>(
    history: MessageLog[] | undefined,
    runner: (session: LlamaChatSession) => Promise<T>
  ): Promise<T> {
    if (Array.isArray(history) && history.length > 0) {
      return runner(ReActLLMDuty.session)
    }

    const tempContext = await LLM_MANAGER.model.createContext()
    const { LlamaChatSession } = await Function(
      'return import("node-llama-cpp")'
    )()
    const tempSession = new LlamaChatSession({
      contextSequence: tempContext.getSequence(),
      autoDisposeSequence: true,
      systemPrompt: this.systemPrompt as string
    })

    try {
      return await runner(tempSession)
    } finally {
      tempSession.dispose({ disposeSequence: true })
      await tempContext.dispose()
    }
  }

  private async callLLM(
    prompt: string,
    systemPrompt: string,
    schema: Record<string, unknown>,
    history?: MessageLog[],
    promptSections?: PromptLogSection[],
    options?: LLMCallOptions
  ): Promise<{
    output: unknown
    usedInputTokens?: number
    usedOutputTokens?: number
    generationDurationMs?: number
    providerDecodeDurationMs?: number
    providerTokensPerSecond?: number
    reasoning?: string
  } | null> {
    const phase = options?.phase ?? 'execution'
    const completionStartedAt = Date.now()
    const phasePolicy = getPhasePolicy(phase)
    const requestedReasoningMode =
      options?.disableThinking === true
        ? 'off'
        : (options?.reasoningMode ?? phasePolicy.reasoningMode)
    const reasoningMode = getEffectiveReasoningMode(
      phase,
      requestedReasoningMode
    )
    const disableThinking = reasoningMode === 'off'
    const shouldEmitReasoning =
      reasoningMode === 'off'
        ? false
        : (options?.emitReasoning ?? phasePolicy.emitReasoning)
    const shouldStream =
      (options?.streamToProvider ?? phasePolicy.streamToProvider) &&
      getLLMProviderName() !== LLMProviders.Local
    const reasoningGenerationId = shouldEmitReasoning
      ? this.getReasoningGenerationId(
          phase,
          StringHelper.random(6, { onlyLetters: true })
        )
      : null

    this.logPromptDispatch({
      phase,
      channel: 'json',
      prompt,
      systemPrompt,
      phasePolicySummary: formatPhasePolicyForLog(phase, phasePolicy),
      shouldStream,
      schema,
      ...(promptSections ? { promptSections } : {}),
      ...(history ? { history } : {})
    })

    const completionParams = {
      dutyType: LLMDuties.ReAct,
      systemPrompt,
      data: schema,
      temperature: REACT_TEMPERATURE,
      timeout: REACT_INFERENCE_TIMEOUT_MS,
      maxRetries: REACT_TIMEOUT_MAX_RETRIES,
      shouldStream,
      ...(shouldEmitReasoning && reasoningGenerationId
        ? {
            onReasoningToken: (reasoningChunk: string): void => {
              this.emitReasoningToken(
                reasoningChunk,
                reasoningGenerationId,
                phase
              )
            }
          }
        : {}),
      reasoningMode,
      ...(disableThinking ? { disableThinking: true } : {}),
      ...(history ? { history } : {})
    }

    let result
    if (getLLMProviderName() === LLMProviders.Local) {
      result = await this.withLocalPromptSession(history, (session) =>
        LLM_PROVIDER.prompt(prompt, {
          ...completionParams,
          session
        })
      )
    } else {
      result = await LLM_PROVIDER.prompt(prompt, completionParams)
    }

    if (result) {
      const completionEndedAt = Date.now()
      this.observeCompletionMetrics({
        phase,
        channel: 'json',
        completionStartedAt,
        completedAt: completionEndedAt,
        output: result.output,
        reasoning: result.reasoning,
        usedInputTokens: result.usedInputTokens,
        usedOutputTokens: result.usedOutputTokens,
        providerDecodeDurationMs: result.providerDecodeDurationMs,
        providerTokensPerSecond: result.providerTokensPerSecond,
        generationDurationMs: result.generationDurationMs
      })
    }

    return result
  }

  private async callLLMText(
    prompt: string,
    systemPrompt: string,
    history?: MessageLog[],
    shouldStream?: boolean,
    promptSections?: PromptLogSection[],
    options?: LLMCallOptions
  ): Promise<{
    output: string
    usedInputTokens?: number
    usedOutputTokens?: number
    generationDurationMs?: number
    providerDecodeDurationMs?: number
    providerTokensPerSecond?: number
    reasoning?: string
  } | null> {
    const phase = options?.phase ?? 'execution'
    const completionStartedAt = Date.now()
    let firstVisibleTokenAt: number | null = null
    const phasePolicy = getPhasePolicy(phase)
    const requestedReasoningMode =
      options?.disableThinking === true
        ? 'off'
        : (options?.reasoningMode ?? phasePolicy.reasoningMode)
    const reasoningMode = getEffectiveReasoningMode(
      phase,
      requestedReasoningMode
    )
    const disableThinking = reasoningMode === 'off'
    const shouldEmitReasoning =
      reasoningMode === 'off'
        ? false
        : (options?.emitReasoning ?? phasePolicy.emitReasoning)
    const shouldStreamToUser =
      options?.streamToUser ?? shouldStream ?? phasePolicy.streamToUser
    const shouldStreamEffective =
      (options?.streamToProvider ?? phasePolicy.streamToProvider) &&
      getLLMProviderName() !== LLMProviders.Local
    const reasoningGenerationId = shouldEmitReasoning
      ? this.getReasoningGenerationId(
          phase,
          StringHelper.random(6, { onlyLetters: true })
        )
      : null

    this.logPromptDispatch({
      phase,
      channel: 'text',
      prompt,
      systemPrompt,
      phasePolicySummary: formatPhasePolicyForLog(phase, phasePolicy),
      shouldStream: shouldStreamEffective,
      ...(promptSections ? { promptSections } : {}),
      ...(history ? { history } : {})
    })

    const generationId = shouldStreamToUser
      ? StringHelper.random(6, { onlyLetters: true })
      : null

    const completionParams = {
      dutyType: LLMDuties.ReAct,
      systemPrompt,
      temperature: REACT_TEMPERATURE,
      timeout: REACT_INFERENCE_TIMEOUT_MS,
      maxRetries: REACT_TIMEOUT_MAX_RETRIES,
      shouldStream: shouldStreamEffective,
      ...(shouldEmitReasoning && reasoningGenerationId
        ? {
            onReasoningToken: (reasoningChunk: string): void => {
              this.emitReasoningToken(
                reasoningChunk,
                reasoningGenerationId,
                phase
              )
            }
          }
        : {}),
      reasoningMode,
      ...(disableThinking ? { disableThinking: true } : {}),
      ...(shouldStreamToUser
        ? {
            onToken: (chunk: unknown): void => {
              const token = StringHelper.normalizeUserFacingText(
                typeof chunk === 'string'
                  ? chunk
                  : LLM_PROVIDER.cleanUpResult(
                      LLM_MANAGER.model.detokenize(
                        chunk as Parameters<
                          typeof LLM_MANAGER.model.detokenize
                        >[0]
                      )
                    )
              )

              if (phase === 'final_answer' && token.trim()) {
                if (firstVisibleTokenAt === null) {
                  firstVisibleTokenAt = Date.now()
                }
              }

              if (!token || !generationId) {
                return
              }

              this.hasStreamedTokenEmission = true
              SOCKET_SERVER.emitToChatClients('llm-token', {
                token,
                generationId
              })
            }
          }
        : {}),
      ...(history ? { history } : {})
    }

    let result
    if (getLLMProviderName() === LLMProviders.Local) {
      result = await this.withLocalPromptSession(history, (session) =>
        LLM_PROVIDER.prompt(prompt, {
          ...completionParams,
          session
        })
      )
    } else {
      result = await LLM_PROVIDER.prompt(prompt, completionParams)
    }

    if (!result) {
      return null
    }

    const completionEndedAt = Date.now()
    this.observeCompletionMetrics({
      phase,
      channel: 'text',
      completionStartedAt,
      completedAt: completionEndedAt,
      output: result.output,
      reasoning: result.reasoning,
      usedInputTokens: result.usedInputTokens,
      usedOutputTokens: result.usedOutputTokens,
      providerDecodeDurationMs: result.providerDecodeDurationMs,
      providerTokensPerSecond: result.providerTokensPerSecond,
      generationDurationMs: result.generationDurationMs,
      ...(firstVisibleTokenAt ? { firstTokenAt: firstVisibleTokenAt } : {})
    })

    return {
      output:
        typeof result.output === 'string'
          ? result.output
          : this.safeJSONStringify(result.output),
      usedInputTokens: result.usedInputTokens,
      usedOutputTokens: result.usedOutputTokens,
      generationDurationMs: result.generationDurationMs,
      ...(result.providerTokensPerSecond
        ? { providerTokensPerSecond: result.providerTokensPerSecond }
        : {}),
      ...(result.providerDecodeDurationMs
        ? { providerDecodeDurationMs: result.providerDecodeDurationMs }
        : {}),
      ...(result.reasoning ? { reasoning: result.reasoning } : {})
    }
  }

  /**
   * Calls the LLM using native tool calling (OpenAI-compatible `tools` API).
   * Returns parsed tool call if successful, or null if the model responded
   * with text content instead.
   */
  private async callLLMWithTools(
    prompt: string,
    systemPrompt: string,
    tools: OpenAITool[],
    toolChoice?: OpenAIToolChoice,
    history?: MessageLog[],
    shouldStreamToUser?: boolean,
    promptSections?: PromptLogSection[],
    options?: LLMCallOptions
  ): Promise<{
    toolCall?: { functionName: string, arguments: string }
    unexpectedToolCall?: { functionName: string, arguments: string }
    textContent?: string
    usedInputTokens?: number
    usedOutputTokens?: number
    generationDurationMs?: number
    providerDecodeDurationMs?: number
    providerTokensPerSecond?: number
    reasoning?: string
  } | null> {
    const phase = options?.phase ?? 'execution'
    const completionStartedAt = Date.now()
    const phasePolicy = getPhasePolicy(phase)
    const effectiveToolChoice: OpenAIToolChoice | undefined =
      tools.length === 0 ? undefined : (toolChoice ?? 'auto')
    const requestedReasoningMode =
      options?.disableThinking === true
        ? 'off'
        : (options?.reasoningMode ?? phasePolicy.reasoningMode)
    const reasoningMode = getEffectiveReasoningMode(
      phase,
      requestedReasoningMode
    )
    const disableThinking = reasoningMode === 'off'
    const shouldEmitReasoning =
      reasoningMode === 'off'
        ? false
        : (options?.emitReasoning ?? phasePolicy.emitReasoning)
    const shouldStreamToUserEffective =
      options?.streamToUser ?? shouldStreamToUser ?? phasePolicy.streamToUser
    const shouldStreamEffective =
      (options?.streamToProvider ?? phasePolicy.streamToProvider) &&
      getLLMProviderName() !== LLMProviders.Local

    const toolNames = tools.map((t) => t.function.name).join(', ')
    const choiceLabel =
      effectiveToolChoice === undefined
        ? 'omitted'
        : effectiveToolChoice
    const generationId = shouldStreamToUserEffective
      ? StringHelper.random(6, { onlyLetters: true })
      : null
    const reasoningGenerationId = shouldEmitReasoning
      ? this.getReasoningGenerationId(
          phase,
          generationId || StringHelper.random(6, { onlyLetters: true })
        )
      : null

    this.logTitle(phase)
    LogHelper.debug(
      `callLLMWithTools: tools=[${toolNames}] | choice=${choiceLabel}`
    )
    this.logPromptDispatch({
      phase,
      channel: 'tools',
      prompt,
      systemPrompt,
      tools,
      ...(effectiveToolChoice !== undefined
        ? { toolChoice: effectiveToolChoice }
        : {}),
      phasePolicySummary: formatPhasePolicyForLog(phase, phasePolicy),
      shouldStream: shouldStreamEffective,
      ...(promptSections ? { promptSections } : {}),
      ...(history ? { history } : {})
    })

    let completionResult: Awaited<ReturnType<typeof LLM_PROVIDER.prompt>>
    let completed = false
    let waitNoticeTimer: NodeJS.Timeout | null = null
    let diagnosisTimer: NodeJS.Timeout | null = null
    let diagnosisRetryTimer: NodeJS.Timeout | null = null
    const toolCallAbortController = new AbortController()

    const delayReason = this.buildLongToolCallReason(
      prompt,
      systemPrompt,
      tools,
      history
    )

    waitNoticeTimer = setTimeout(() => {
      if (completed) {
        return
      }
      this.logTitle(phase)
      LogHelper.warning(
        `callLLMWithTools: pending > ${TOOL_CALL_WAIT_NOTICE_DELAY_MS}ms`
      )
      void this.emitProgress(
        BRAIN.wernicke('react.tool_call.waiting', '', {
          '{{ reason }}': delayReason
        })
      )
    }, TOOL_CALL_WAIT_NOTICE_DELAY_MS)

    diagnosisTimer = setTimeout(() => {
      if (completed) {
        return
      }

      void this.runLongToolCallDiagnosis(
        prompt,
        systemPrompt,
        tools,
        effectiveToolChoice,
        history
      )

      diagnosisRetryTimer = setTimeout(() => {
        if (completed || toolCallAbortController.signal.aborted) {
          return
        }

        const abortReason: LLMPromptAbortReason = {
          shouldRetry: true,
          retryStrategy: 'timeout',
          source: 'react_tool_call_diagnosis',
          delayMs: TOOL_CALL_DIAGNOSIS_RETRY_DELAY_MS
        }

        this.logTitle(phase)
        LogHelper.warning(
          `callLLMWithTools: diagnosis grace period exceeded (${TOOL_CALL_DIAGNOSIS_RETRY_DELAY_MS}ms); canceling in-flight request and retrying`
        )

        toolCallAbortController.abort(abortReason)
      }, TOOL_CALL_DIAGNOSIS_RETRY_DELAY_MS)
    }, TOOL_CALL_DIAGNOSIS_DELAY_MS)

    try {
      completionResult = await LLM_PROVIDER.prompt(prompt, {
        dutyType: LLMDuties.ReAct,
        systemPrompt,
        temperature: REACT_TEMPERATURE,
        timeout: REACT_INFERENCE_TIMEOUT_MS,
        maxRetries: REACT_TIMEOUT_MAX_RETRIES,
        shouldStream: shouldStreamEffective,
        ...(shouldEmitReasoning && reasoningGenerationId
          ? {
              onReasoningToken: (reasoningChunk: string): void => {
                this.emitReasoningToken(
                  reasoningChunk,
                  reasoningGenerationId,
                  phase
                )
              }
            }
          : {}),
        reasoningMode,
        ...(disableThinking ? { disableThinking: true } : {}),
        ...(shouldStreamToUserEffective
          ? {
              onToken: (chunk: unknown): void => {
                const token = StringHelper.normalizeUserFacingText(
                  typeof chunk === 'string'
                    ? chunk
                    : LLM_PROVIDER.cleanUpResult(
                        LLM_MANAGER.model.detokenize(
                          chunk as Parameters<
                            typeof LLM_MANAGER.model.detokenize
                          >[0]
                        )
                      )
                )

                if (!token || !generationId) {
                  return
                }

                this.hasStreamedTokenEmission = true
                SOCKET_SERVER.emitToChatClients('llm-token', {
                  token,
                  generationId
                })
              }
            }
          : {}),
        tools,
        ...(effectiveToolChoice !== undefined
          ? { toolChoice: effectiveToolChoice }
          : {}),
        signal: toolCallAbortController.signal,
        ...(history ? { history } : {})
      })
    } finally {
      completed = true
      if (waitNoticeTimer) {
        clearTimeout(waitNoticeTimer)
      }
      if (diagnosisTimer) {
        clearTimeout(diagnosisTimer)
      }
      if (diagnosisRetryTimer) {
        clearTimeout(diagnosisRetryTimer)
      }
    }

    if (!completionResult) {
      LogHelper.debug('callLLMWithTools: no completion result returned')
      return null
    }

    const completionEndedAt = Date.now()
    const toolCalls = (
      completionResult as unknown as { toolCalls?: OpenAIToolCall[] }
    ).toolCalls
    this.observeCompletionMetrics({
      phase,
      channel: 'tools',
      completionStartedAt,
      completedAt: completionEndedAt,
      output: completionResult.output,
      reasoning: completionResult.reasoning,
      usedInputTokens: completionResult.usedInputTokens,
      usedOutputTokens: completionResult.usedOutputTokens,
      providerDecodeDurationMs: completionResult.providerDecodeDurationMs,
      providerTokensPerSecond: completionResult.providerTokensPerSecond,
      generationDurationMs: completionResult.generationDurationMs
    })

    // Check if the model responded with tool calls
    if (toolCalls && toolCalls.length > 0) {
      const firstCall = toolCalls[0]!
      const allowedToolNames = new Set(tools.map((t) => t.function.name))
      const resolvedToolName = this.resolveAllowedToolCallName(
        firstCall.function.name,
        allowedToolNames
      )
      if (!resolvedToolName) {
        this.logTitle(phase)
        LogHelper.warning(
          `callLLMWithTools: unexpected tool call "${firstCall.function.name}" (allowed: ${[...allowedToolNames].join(', ') || 'none'})`
        )

        const textContentFallback =
          typeof completionResult.output === 'string'
            ? completionResult.output
            : ''
        return {
          unexpectedToolCall: {
            functionName: firstCall.function.name,
            arguments: firstCall.function.arguments
          },
          textContent: textContentFallback,
          usedInputTokens: completionResult.usedInputTokens,
          usedOutputTokens: completionResult.usedOutputTokens,
          generationDurationMs: completionResult.generationDurationMs,
          ...(completionResult.providerTokensPerSecond
            ? { providerTokensPerSecond: completionResult.providerTokensPerSecond }
            : {}),
          ...(completionResult.providerDecodeDurationMs
            ? { providerDecodeDurationMs: completionResult.providerDecodeDurationMs }
            : {}),
          ...(completionResult.reasoning
            ? { reasoning: completionResult.reasoning }
            : {})
        }
      }
      if (resolvedToolName !== firstCall.function.name) {
        this.logTitle(phase)
        LogHelper.debug(
          `callLLMWithTools: normalized tool call "${firstCall.function.name}" -> "${resolvedToolName}"`
        )
      }
      this.logTitle(phase)
      LogHelper.debug(
        `callLLMWithTools: tool call received — ${resolvedToolName}(${firstCall.function.arguments})`
      )
      return {
        toolCall: {
          functionName: resolvedToolName,
          arguments: firstCall.function.arguments
        },
        usedInputTokens: completionResult.usedInputTokens,
        usedOutputTokens: completionResult.usedOutputTokens,
        generationDurationMs: completionResult.generationDurationMs,
        ...(completionResult.providerTokensPerSecond
          ? { providerTokensPerSecond: completionResult.providerTokensPerSecond }
          : {}),
        ...(completionResult.providerDecodeDurationMs
          ? { providerDecodeDurationMs: completionResult.providerDecodeDurationMs }
          : {}),
        ...(completionResult.reasoning
          ? { reasoning: completionResult.reasoning }
          : {})
      }
    }

    // Model responded with text content (no tool call)
    const textContent =
      typeof completionResult.output === 'string'
        ? completionResult.output
        : ''
    this.logTitle(phase)
    LogHelper.debug(
      `callLLMWithTools: no tool call, text response: "${textContent}"`
    )
    return {
      textContent,
      usedInputTokens: completionResult.usedInputTokens,
      usedOutputTokens: completionResult.usedOutputTokens,
      generationDurationMs: completionResult.generationDurationMs,
      ...(completionResult.providerTokensPerSecond
        ? { providerTokensPerSecond: completionResult.providerTokensPerSecond }
        : {}),
      ...(completionResult.providerDecodeDurationMs
        ? { providerDecodeDurationMs: completionResult.providerDecodeDurationMs }
        : {}),
      ...(completionResult.reasoning
        ? { reasoning: completionResult.reasoning }
        : {})
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private safeJSONStringify(value: unknown): string {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  private resolveAllowedToolCallName(
    requestedName: string,
    allowedToolNames: Set<string>
  ): string | null {
    const normalizedRequested = String(requestedName || '').trim()
    if (!normalizedRequested) {
      return null
    }

    if (allowedToolNames.has(normalizedRequested)) {
      return normalizedRequested
    }

    const allowList = [...allowedToolNames]
    const lowerMatches = allowList.filter(
      (toolName) => toolName.toLowerCase() === normalizedRequested.toLowerCase()
    )
    if (lowerMatches.length === 1) {
      return lowerMatches[0] || null
    }

    const tailCandidate = normalizedRequested
      .split(/[./:]/)
      .filter(Boolean)
      .pop()
    if (!tailCandidate) {
      return null
    }

    if (allowedToolNames.has(tailCandidate)) {
      return tailCandidate
    }

    const lowerTailMatches = allowList.filter(
      (toolName) => toolName.toLowerCase() === tailCandidate.toLowerCase()
    )
    if (lowerTailMatches.length === 1) {
      return lowerTailMatches[0] || null
    }

    return null
  }

  private estimateTokensFromText(text: string): number {
    if (!text) {
      return 0
    }

    return Math.ceil(text.length / CHARS_PER_TOKEN)
  }

  private estimateHistoryTokens(history?: MessageLog[]): number {
    if (!history || history.length === 0) {
      return 0
    }

    const historyChars = history.reduce((total, log) => {
      return total + (log?.message?.length || 0)
    }, 0)

    return Math.ceil(historyChars / CHARS_PER_TOKEN)
  }

  private formatHistoryForPromptLog(history?: MessageLog[]): string {
    if (!history || history.length === 0) {
      return ''
    }

    return JSON.stringify(
      history.map((log) => ({
        who: log.who,
        message: log.message
      })),
      null,
      2
    )
  }

  private buildLogTitle(context?: string): string {
    return context ? `${this.name} / ${context}` : this.name
  }

  private logTitle(context?: string): void {
    LogHelper.title(this.buildLogTitle(context))
  }

  private writePhasePromptLog(params: {
    phase: ReactPhase
    channel: 'json' | 'text' | 'tools'
    systemPrompt: string
    prompt: string
    history?: MessageLog[]
    schema?: Record<string, unknown>
    tools?: OpenAITool[]
    phasePolicySummary?: string
    shouldStream?: boolean
    toolChoice?: OpenAIToolChoice
  }): void {
    try {
      fs.mkdirSync(REACT_PROMPTS_LOG_DIR, { recursive: true })

      const promptLogFilePath = path.join(
        REACT_PROMPTS_LOG_DIR,
        `${params.phase}.log`
      )
      const headerLines = [
        `=== ${new Date().toISOString()} ===`,
        `phase=${params.phase}`,
        `channel=${params.channel}`,
        `stream=${params.shouldStream === true ? 'true' : 'false'}`,
        ...(params.phasePolicySummary
          ? [`policy=${params.phasePolicySummary}`]
          : []),
        ...(params.tools
          ? [
              `tool_count=${params.tools.length}`,
              `tool_choice=${
                params.toolChoice === undefined
                  ? 'omitted'
                  : typeof params.toolChoice === 'string'
                    ? params.toolChoice
                    : params.toolChoice.function.name
              }`
            ]
          : []),
        ''
      ]
      const sectionLines = [
        '--- SYSTEM_PROMPT ---',
        params.systemPrompt,
        '',
        '--- PHASE_INPUT ---',
        params.prompt,
        ''
      ]

      const formattedHistory = this.formatHistoryForPromptLog(params.history)
      if (formattedHistory) {
        sectionLines.push('--- HISTORY ---', formattedHistory, '')
      }

      if (params.schema) {
        sectionLines.push(
          '--- JSON_SCHEMA ---',
          this.safeJSONStringify(params.schema),
          ''
        )
      }

      if (params.tools && params.tools.length > 0) {
        sectionLines.push(
          '--- TOOLS_SCHEMA ---',
          this.safeJSONStringify(params.tools),
          ''
        )
      }

      fs.writeFileSync(
        promptLogFilePath,
        `${[...headerLines, ...sectionLines].join('\n')}\n`,
        'utf8'
      )
    } catch (error) {
      this.logTitle(params.phase)
      LogHelper.warning(
        `Failed to write prompt log file: ${String(error)}`
      )
    }
  }

  private logPromptDispatch(params: {
    phase: ReactPhase
    channel: 'json' | 'text' | 'tools'
    prompt: string
    systemPrompt: string
    phasePolicySummary?: string
    history?: MessageLog[]
    schema?: Record<string, unknown>
    tools?: OpenAITool[]
    toolChoice?: OpenAIToolChoice
    shouldStream?: boolean
    promptSections?: PromptLogSection[]
  }): void {
    const promptTokens = this.estimateTokensFromText(params.prompt)
    const systemTokens = this.estimateTokensFromText(params.systemPrompt)
    const historyTokens = this.estimateHistoryTokens(params.history)
    const schemaTokens = params.schema
      ? this.estimateTokensFromText(this.safeJSONStringify(params.schema))
      : 0
    const toolsTokens = params.tools
      ? this.estimateTokensFromText(this.safeJSONStringify(params.tools))
      : 0
    const totalEstimated =
      promptTokens + systemTokens + historyTokens + schemaTokens + toolsTokens

    this.logTitle(params.phase)
    LogHelper.debug(
      `Prompt dispatch [${params.channel}] est_tokens=${totalEstimated} (prompt=${promptTokens}, system=${systemTokens}, history=${historyTokens}${schemaTokens > 0 ? `, schema=${schemaTokens}` : ''}${toolsTokens > 0 ? `, tools=${toolsTokens}` : ''})${
        params.shouldStream === true ? ' | stream=true' : ''
      }${
        params.phasePolicySummary ? ` | ${params.phasePolicySummary}` : ''
      }${
        params.tools
          ? ` | tools=${params.tools.length} | tool_choice=${
              params.toolChoice === undefined
                ? 'omitted'
                : typeof params.toolChoice === 'string'
                  ? params.toolChoice
                  : params.toolChoice.function.name
            }`
          : ''
      }`
    )
    const sections =
      params.promptSections && params.promptSections.length > 0
        ? params.promptSections
        : this.buildDefaultPromptSections(params)
    this.writePhasePromptLog({
      phase: params.phase,
      channel: params.channel,
      systemPrompt: params.systemPrompt,
      prompt: params.prompt,
      ...(params.history ? { history: params.history } : {}),
      ...(params.schema ? { schema: params.schema } : {}),
      ...(params.tools ? { tools: params.tools } : {}),
      ...(params.phasePolicySummary !== undefined
        ? { phasePolicySummary: params.phasePolicySummary }
        : {}),
      ...(params.shouldStream !== undefined
        ? { shouldStream: params.shouldStream }
        : {}),
      ...(params.toolChoice !== undefined
        ? { toolChoice: params.toolChoice }
        : {})
    })

    if (sections.length > 0) {
      LogHelper.debug(
        `Prompt sections [${params.channel}]:\n${sections
          .map((section) => {
            const sectionTokens = this.estimateTokensFromText(
              section.content ?? ''
            )
            return `- ${section.name} (${this.compactSectionSourcePath(
              section.source
            )}) | est_tokens=${sectionTokens}`
          })
          .join('\n')}`
      )
    }
  }

  private compactSectionSourcePath(source: string): string {
    const normalized = String(source || '').replace(/\\/g, '/')
    const parts = normalized.split('/').filter((part) => part.length > 0)
    if (parts.length <= 2) {
      return parts.join('/')
    }

    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
  }

  private buildDefaultPromptSections(params: {
    prompt: string
    systemPrompt: string
    schema?: Record<string, unknown>
    tools?: OpenAITool[]
    history?: MessageLog[]
  }): PromptLogSection[] {
    const sections: PromptLogSection[] = [
      {
        name: 'SYSTEM_PROMPT',
        source: 'server/src/core/llm-manager/persona.ts',
        content: params.systemPrompt
      },
      {
        name: 'PHASE_PROMPT',
        source: 'server/src/core/llm-manager/llm-duties/react-llm-duty/*.ts',
        content: params.prompt
      }
    ]

    if (params.schema) {
      sections.push({
        name: 'JSON_SCHEMA',
        source: 'server/src/core/llm-manager/llm-duties/react-llm-duty/*.ts',
        content: this.safeJSONStringify(params.schema)
      })
    }

    if (params.tools && params.tools.length > 0) {
      sections.push({
        name: 'TOOLS_SCHEMA',
        source: 'server/src/core/llm-manager/llm-duties/react-llm-duty/*.ts',
        content: this.safeJSONStringify(params.tools)
      })
    }

    if (params.history && params.history.length > 0) {
      sections.push({
        name: 'HISTORY',
        source: 'core/conversation_logger',
        content: params.history.map((entry) => entry.message || '').join('\n')
      })
    }

    return sections
  }

  private logPromptUsage(
    phase: ReactPhase,
    channel: 'json' | 'text' | 'tools',
    usedInputTokens: number,
    usedOutputTokens: number
  ): void {
    this.logTitle(phase)
    LogHelper.debug(
      `Prompt usage [${channel}] input=${usedInputTokens} output=${usedOutputTokens} | total=${this.totalInputTokens}+${this.totalOutputTokens}=${this.totalInputTokens + this.totalOutputTokens}`
    )
  }

  private observeCompletionMetrics(params: {
    phase: ReactPhase
    channel: 'json' | 'text' | 'tools'
    completionStartedAt: number
    completedAt: number
    output?: unknown | undefined
    reasoning?: string | undefined
    usedInputTokens?: number | undefined
    usedOutputTokens?: number | undefined
    generationDurationMs?: number | undefined
    providerDecodeDurationMs?: number | undefined
    providerTokensPerSecond?: number | undefined
    firstTokenAt?: number | null | undefined
  }): void {
    const observedMetrics = observeCompletionMetrics({
      providerName: getLLMProviderName(),
      accumulator: {
        totalInputTokens: this.totalInputTokens,
        totalOutputTokens: this.totalOutputTokens,
        totalVisibleOutputTokens: this.totalVisibleOutputTokens,
        totalOutputChars: this.totalOutputChars,
        totalGenerationDurationMs: this.totalGenerationDurationMs,
        phaseMetrics: this.phaseMetrics,
        finalAnswerMetrics: this.finalAnswerMetrics
      } satisfies AccumulatedLLMMetricsState,
      phase: params.phase,
      completionStartedAt: params.completionStartedAt,
      completedAt: params.completedAt,
      output: params.output,
      reasoning: params.reasoning,
      usedInputTokens: params.usedInputTokens,
      usedOutputTokens: params.usedOutputTokens,
      generationDurationMs: params.generationDurationMs,
      providerDecodeDurationMs: params.providerDecodeDurationMs,
      providerTokensPerSecond: params.providerTokensPerSecond,
      ...(params.firstTokenAt ? { firstTokenAt: params.firstTokenAt } : {}),
      estimateTokensFromText: this.estimateTokensFromText.bind(this),
      ...(getLLMProviderName() === LLMProviders.Local && LLM_MANAGER.model
        ? {
            tokenizeLocally: (text: string): number =>
              LLM_MANAGER.model.tokenize(text).length
          }
        : {})
    })
    this.totalInputTokens = observedMetrics.accumulator.totalInputTokens
    this.totalOutputTokens = observedMetrics.accumulator.totalOutputTokens
    this.totalVisibleOutputTokens =
      observedMetrics.accumulator.totalVisibleOutputTokens
    this.totalOutputChars = observedMetrics.accumulator.totalOutputChars
    this.totalGenerationDurationMs =
      observedMetrics.accumulator.totalGenerationDurationMs
    this.phaseMetrics = observedMetrics.accumulator.phaseMetrics
    this.finalAnswerMetrics = observedMetrics.accumulator.finalAnswerMetrics

    this.logPromptUsage(
      params.phase,
      params.channel,
      params.usedInputTokens ?? 0,
      params.usedOutputTokens ?? 0
    )
    this.logPromptReasoning(params.phase, params.channel, params.reasoning)
  }

  private logPromptReasoning(
    phase: ReactPhase,
    channel: 'json' | 'text' | 'tools',
    reasoning?: string
  ): void {
    this.logTitle(phase)
    if (reasoning && reasoning.trim()) {
      LogHelper.debug(`Prompt reasoning [${channel}]:\n${reasoning.trim()}`)
      return
    }

    LogHelper.debug(`Prompt reasoning [${channel}]: none`)
  }

  private buildLongToolCallReason(
    prompt: string,
    systemPrompt: string,
    tools: OpenAITool[],
    history?: MessageLog[]
  ): string {
    const estimatedPromptTokens =
      this.estimateTokensFromText(prompt) +
      this.estimateTokensFromText(systemPrompt) +
      this.estimateTokensFromText(JSON.stringify(tools)) +
      this.estimateHistoryTokens(history)

    if (estimatedPromptTokens > 4_500) {
      return BRAIN.wernicke('react.tool_call.reason.large_prompt', '', {
        '{{ estimated_tokens }}': String(estimatedPromptTokens)
      })
    }

    if (tools.length > 1) {
      return BRAIN.wernicke('react.tool_call.reason.multi_tools', '', {
        '{{ tool_count }}': String(tools.length)
      })
    }

    return BRAIN.wernicke('react.tool_call.reason.provider_latency')
  }

  private async runLongToolCallDiagnosis(
    prompt: string,
    systemPrompt: string,
    tools: OpenAITool[],
    toolChoice: OpenAIToolChoice | undefined,
    history?: MessageLog[]
  ): Promise<void> {
    const promptTokens =
      this.estimateTokensFromText(prompt) +
      this.estimateTokensFromText(systemPrompt)
    const toolSchemaTokens = this.estimateTokensFromText(JSON.stringify(tools))
    const historyTokens = this.estimateHistoryTokens(history)
    const totalEstimatedTokens =
      promptTokens + toolSchemaTokens + historyTokens
    const forcedChoice =
      toolChoice === undefined
        ? 'omitted'
        : typeof toolChoice === 'string'
          ? toolChoice
          : `forced:${toolChoice.function.name}`

    const diagnosisMessage = BRAIN.wernicke('react.tool_call.diagnosis', '', {
      '{{ provider }}': getLLMProviderName(),
      '{{ tool_choice }}': forcedChoice,
      '{{ tool_count }}': String(tools.length),
      '{{ total_tokens }}': String(totalEstimatedTokens),
      '{{ prompt_tokens }}': String(promptTokens),
      '{{ tool_tokens }}': String(toolSchemaTokens),
      '{{ history_tokens }}': String(historyTokens)
    })

    this.logTitle('execution')
    LogHelper.warning(
      `Long tool-call diagnosis (> ${TOOL_CALL_DIAGNOSIS_DELAY_MS}ms): ${diagnosisMessage}`
    )

    await this.emitProgress(diagnosisMessage)
  }

  private async emitProgress(message: string): Promise<void> {
    if (!message) {
      return
    }

    try {
      await BRAIN.talk(message)
    } catch (error) {
      this.logTitle('execution')
      LogHelper.warning(
        `Failed to emit intermediate progress message: ${String(error)}`
      )
    }
  }

  private toProgressiveMessage(message: string): string {
    const normalized = String(message || '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!normalized) {
      return 'Working...'
    }

    const withEllipsis = normalized.endsWith('...')
      ? normalized
      : `${normalized.replace(/[.?!]+$/g, '')}...`

    return withEllipsis
  }

  private makeDutyResult(output: string): LLMDutyResult {
    if (!this.finalAnswerPhaseCompleted) {
      throw new Error(
        'ReAct invariant violation: user-facing output must be produced by final_answer phase.'
      )
    }

    const normalizedOutput = StringHelper.normalizeUserFacingText(output)

    if (!this.hasStreamedTokenEmission && normalizedOutput?.trim()) {
      this.emitSyntheticTokenStream(normalizedOutput)
    }

    this.logTitle('final_answer')
    LogHelper.success('Duty executed')
    LogHelper.success(`Output — ${normalizedOutput}`)
    LogHelper.debug(
      `Total tokens — input: ${this.totalInputTokens} | output: ${this.totalOutputTokens} | combined: ${this.totalInputTokens + this.totalOutputTokens}`
    )

    const llmMetrics = deriveLLMMetrics({
      providerName: getLLMProviderName(),
      normalizedOutput,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalVisibleOutputTokens: this.totalVisibleOutputTokens,
      totalOutputChars: this.totalOutputChars,
      totalGenerationDurationMs: this.totalGenerationDurationMs,
      turnDurationMs: Math.max(Date.now() - this.executionStartedAt, 0),
      phaseMetrics: this.phaseMetrics,
      finalAnswerMetrics: this.finalAnswerMetrics,
      estimateTokensFromText: this.estimateTokensFromText.bind(this),
      ...(getLLMProviderName() === LLMProviders.Local && LLM_MANAGER.model
        ? {
            tokenizeLocally: (text: string): number =>
              LLM_MANAGER.model.tokenize(text).length
          }
        : {})
    })

    return {
      dutyType: LLMDuties.ReAct,
      systemPrompt: this.systemPrompt,
      input: this.input,
      output: normalizedOutput,
      data: {
        hasExplicitMemoryWrite: this.hasExplicitMemoryWrite,
        finalIntent: this.finalResponseIntent,
        llmMetrics,
        executionHistory: this.lastExecutionHistory.map((item) => ({
          function: item.function,
          status: item.status,
          observation: item.observation,
          stepLabel: item.stepLabel,
          requestedToolInput: item.requestedToolInput
        }))
      }
    } as unknown as LLMDutyResult
  }

  private getReasoningGenerationId(
    phase: ReactPhase,
    fallbackGenerationId?: string | null
  ): string | null {
    const baseGenerationId =
      this.reasoningGenerationId || fallbackGenerationId || null

    if (!baseGenerationId) {
      return null
    }

    return `${baseGenerationId}_${phase}`
  }

  private emitReasoningToken(
    token: string,
    generationId: string,
    phase: ReactPhase
  ): void {
    if (!token || !generationId) {
      return
    }

    const chunks = token.match(/(\s+|[^\s]+)/g) || [token]
    for (const chunk of chunks) {
      SOCKET_SERVER.emitToChatClients('llm-reasoning-token', {
        token: chunk,
        generationId,
        phase
      })
    }
  }

  private emitSyntheticTokenStream(output: string): void {
    const generationId = StringHelper.random(6, { onlyLetters: true })
    const chunks = output.match(/(\s+|[^\s]+)/g) || [output]

    this.hasStreamedTokenEmission = chunks.length > 0

    for (const token of chunks) {
      SOCKET_SERVER.emitToChatClients('llm-token', {
        token,
        generationId
      })
    }
  }
}
