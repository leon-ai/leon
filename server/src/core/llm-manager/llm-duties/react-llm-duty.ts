import fs from 'node:fs'
import path from 'node:path'

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
  LLM_PROVIDER,
  PERSONA,
  TOOLKIT_REGISTRY,
  CONTEXT_MANAGER,
  SELF_MODEL_MANAGER,
  CONVERSATION_LOGGER,
  BRAIN,
  SOCKET_SERVER,
  TOOL_CALL_LOGGER,
  POST_TURN_MAINTENANCE_QUEUE
} from '@/core'
import {
  LLMDuties,
  LLMProviders,
  type LLMPromptAbortReason,
  type AgentToolTranscriptMessage,
  type OpenAITool,
  type OpenAIToolCall
} from '@/core/llm-manager/types'
import { ContextStateStore } from '@/core/context-manager/context-state-store'
import type { MessageLog } from '@/types'
import { ConversationHistoryHelper } from '@/helpers/conversation-history-helper'
import { CONFIG_STATE } from '@/core/config-states/config-state'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'
import { getActiveConversationSessionId } from '@/core/session-manager/session-context'
import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import { isLocalLLMProvider } from '@/core/llm-manager/model-context-windows'
import { CONFIG_MANAGER } from '@/config'

function getLLMProviderName(): LLMProviders {
  const provider = CONFIG_STATE.getModelState().getAgentProvider()

  if (!provider) {
    throw new Error('The agent LLM provider is disabled.')
  }

  return provider
}

import {
  AGENT_TEMPERATURE,
  AGENT_INFERENCE_TIMEOUT_MS,
  AGENT_TIMEOUT_MAX_RETRIES,
  CHARS_PER_TOKEN,
  AGENT_TOOL_CALL_WAIT_NOTICE_DELAY_MS,
  AGENT_TOOL_CALL_DIAGNOSIS_DELAY_MS,
  AGENT_TOOL_CALL_DIAGNOSIS_RETRY_DELAY_MS,
  AGENT_HISTORY_COMPACTION_MAX_TOKENS,
  AGENT_HISTORY_COMPACTION_RETRY_MAX_TOKENS,
  AGENT_HISTORY_COMPACTION_SYSTEM_PROMPT,
  AGENT_LOCAL_PROVIDER_HISTORY_LOGS,
  AGENT_LOCAL_PROVIDER_HISTORY_COMPACTION_POINT,
  AGENT_REMOTE_PROVIDER_HISTORY_LOGS,
  AGENT_REMOTE_PROVIDER_HISTORY_COMPACTION_POINT,
  AGENT_MAX_ITERATIONS
} from './react-llm-duty/constants'
import type {
  ReactLLMDutyParams,
  ExecutionRecord,
  TrackedPlanStep,
  PlanStepStatus,
  LLMCaller,
  FinalResponseSignal,
  AgentPhase,
  AgentSkillContext
} from './react-llm-duty/types'
import { widgetId, emitPlanWidget } from './react-llm-duty/plan-widget'
import {
  getAgentInferencePolicy,
  formatAgentInferencePolicyForLog
} from './react-llm-duty/agent-policy'
import { runToolExecution } from './react-llm-duty/tool-execution'
import {
  AGENT_LIMIT_FINALIZATION_SYSTEM_PROMPT,
  AGENT_SYSTEM_PROMPT,
  AgentModelProviderError,
  buildAgentConvergenceSystemPrompt,
  buildAgentToolCatalog,
  buildAgentTranscriptHistory,
  runAgentLoop
} from './react-llm-duty/agent-loop'
import { buildToolkitContextSection } from './react-llm-duty/agent-helpers'
import {
  buildCompactedHistoryMessage,
  findMessageSequenceStart,
  formatHistoryForCompaction,
  hasHistoryCompactionContent,
  normalizeHistoryCompactionSummary
} from './react-llm-duty/history-compaction'
import {
  type AccumulatedLLMMetricsState,
  type FinalAnswerMetricsSnapshot,
  type RawPhaseMetrics,
  deriveLLMMetrics,
  observeCompletionMetrics
} from './react-llm-duty/metrics'
import {
  createAgentLoopContinuationState,
  isAgentLoopContinuationStateValid,
  type AgentLoopContinuationState
} from './react-llm-duty/agent-loop-continuation'
import {
  prepareAgentModelContext,
  resolveAgentContextCompactionTriggerTokens,
  resolveAgentContextRecoveryTriggerTokens,
  resolveAgentMaxOutputTokens
} from './react-llm-duty/agent-context-budget'

const AGENT_PROMPT_CACHE_KEY = 'leon-agent'
const TRUNCATED_COMPLETION_FINISH_REASONS = new Set([
  'length',
  'max_tokens',
  'max_output_tokens',
  'incomplete'
])

const AGENT_CONTINUATION_STATE_FILENAME = '.agent-loop-continuation-state.json'
// Preserve existing rolling summaries across the loop migration.
const AGENT_HISTORY_COMPACTION_STATE_FILENAME =
  '.react-history-compaction-state.json'
const AGENT_SESSION_STATE_FILENAME_SEPARATOR = '--'

type AgentHistoryCompactionScope = 'local' | 'remote'

interface PreparedAgentHistory {
  messageLogs: MessageLog[]
}

function emitAgentSkillActivityToWebApp(
  agentSkillContext: AgentSkillContext
): void {
  const skillGroupId =
    `agent_skill_${agentSkillContext.id}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

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

interface AgentHistoryCompactionProviderState {
  summary: string | null
  summarySentAt: number | null
  tail: MessageLog[]
  newMessagesSinceCompaction: number
}

interface AgentHistoryCompactionState {
  version: 1
  local: AgentHistoryCompactionProviderState
  remote: AgentHistoryCompactionProviderState
}

interface AgentHistoryCompactionConfig {
  historyLimit: number
  compactionBatchSize: number
}

function createEmptyHistoryCompactionProviderState(): AgentHistoryCompactionProviderState {
  return {
    summary: null,
    summarySentAt: null,
    tail: [],
    newMessagesSinceCompaction: 0
  }
}

const AGENT_HISTORY_COMPACTION_STATE_FALLBACK: AgentHistoryCompactionState = {
  version: 1,
  local: createEmptyHistoryCompactionProviderState(),
  remote: createEmptyHistoryCompactionProviderState()
}

export class ReActLLMDuty extends LLMDuty {
  private static instance: ReActLLMDuty
  private static readonly continuationStateStores =
    new Map<string, ContextStateStore<AgentLoopContinuationState | null>>()
  private static readonly historyCompactionStateStores =
    new Map<string, ContextStateStore<AgentHistoryCompactionState>>()
  protected systemPrompt: LLMDutyParams['systemPrompt'] = null
  protected readonly name = 'Agent LLM Duty'
  protected input: LLMDutyParams['input'] = null
  private completionCount = 0
  private totalInputTokens = 0
  private totalOutputTokens = 0
  private totalVisibleOutputTokens = 0
  private totalOutputChars = 0
  private totalGenerationDurationMs = 0
  private phaseMetrics: RawPhaseMetrics = {
    agent: { outputTokens: 0, durationMs: 0 },
    final_answer: { outputTokens: 0, durationMs: 0 }
  }
  private finalAnswerMetrics: FinalAnswerMetricsSnapshot | null = null

  private executionStartedAt = 0
  private hasExplicitMemoryWrite = false
  private reasoningGenerationId: string | null = null
  private hasFinalizedAnswer = false
  private finalResponseIntent: FinalResponseSignal['intent'] = 'answer'
  private lastExecutionHistory: ExecutionRecord[] = []
  private activeAgentSkillContext: AgentSkillContext | null
  private activeForcedToolName: string | null
  private allowDirectAnswerHandoff: boolean
  private readonly additionalInstructions: string

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
    this.allowDirectAnswerHandoff = params.allowDirectAnswerHandoff === true
    this.additionalInstructions = params.additionalInstructions?.trim() || ''
    this.systemPrompt = this.appendAdditionalInstructions(
      PERSONA.getCompactDutySystemPrompt(AGENT_SYSTEM_PROMPT, {
        includePersonality: false,
        includeMood: false
      })
    )
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
  }

  public async execute(): Promise<LLMDutyResult | null> {
    LogHelper.title(this.name)
    LogHelper.info('Executing...')

    this.executionStartedAt = Date.now()
    this.completionCount = 0
    this.totalInputTokens = 0
    this.totalOutputTokens = 0
    this.totalVisibleOutputTokens = 0
    this.totalOutputChars = 0
    this.totalGenerationDurationMs = 0
    this.phaseMetrics = {
      agent: { outputTokens: 0, durationMs: 0 },
      final_answer: { outputTokens: 0, durationMs: 0 }
    }
    this.finalAnswerMetrics = null
    this.hasExplicitMemoryWrite = false
    this.reasoningGenerationId = StringHelper.random(6, { onlyLetters: true })
    this.hasFinalizedAnswer = false
    this.finalResponseIntent = 'answer'
    this.lastExecutionHistory = []

    try {
      const { messageLogs: history } = await this.loadPreparedHistory()

      const ownerInput = this.getInputAsText(this.input)
      const continuation = this.consumeAgentLoopContinuation()
      const originalInput = continuation?.originalInput || ownerInput
      const planWidgetIdValue =
        continuation?.planWidgetId || widgetId('plan')
      let trackedSteps =
        continuation?.trackedSteps.map((step) => ({ ...step })) || []
      let hasPlanningWidget = trackedSteps.length > 0
      const executionHistory: ExecutionRecord[] = []
      let emittedAgentSkillActivityId: string | null = null
      const caller = this.createLLMCaller()
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
      const finalize = (
        answer: string,
        intent: FinalResponseSignal['intent']
      ): LLMDutyResult => {
        this.hasFinalizedAnswer = true
        this.finalResponseIntent = intent
        this.lastExecutionHistory = executionHistory.map((item) => ({
          ...item
        }))

        const dutyResult = this.makeDutyResult(answer)
        POST_TURN_MAINTENANCE_QUEUE.enqueue(
          'agent history compaction',
          () => this.maybeCompactHistoryAfterAnswer(
            planWidgetIdValue,
            trackedSteps
          )
        )

        return dutyResult
      }

      const catalog = buildAgentToolCatalog(
        this.activeForcedToolName,
        continuation?.loadedToolkitIds,
        CONFIG_MANAGER.getConfig().runtime.progressive_toolkit_loading
      )
      if (catalog.tools.length === 0) {
        return finalize(
          `The tool "${this.activeForcedToolName}" is not available.`,
          'error'
        )
      }

      const agentSystemPrompt = this.appendAdditionalInstructions(
        PERSONA.getCompactDutySystemPrompt(
          AGENT_SYSTEM_PROMPT,
          {
            includePersonality: true,
            includeMood: true
          }
        )
      )
      this.systemPrompt = agentSystemPrompt

      const transcript = continuation
        ? structuredClone(continuation.transcript)
        : buildAgentTranscriptHistory(history, ownerInput)
      if (continuation) {
        transcript.push({
          role: 'user',
          content: [
            '<clarification_response>',
            ownerInput,
            '</clarification_response>'
          ].join('\n')
        })
      } else {
        transcript.push({
          role: 'user',
          content: await this.buildAgentRequest(caller, originalInput)
        })
      }

      LogHelper.title(this.name)
      LogHelper.debug(
        'Using continuous agent loop with ' +
          catalog.tools.length +
          ' initial tool schema(s) for provider ' +
          getLLMProviderName()
      )

      const result = await runAgentLoop({
        transcript,
        catalog,
        maxIterations: AGENT_MAX_ITERATIONS,
        ...(continuation
          ? {
              initialExecutionHistory: continuation.executionHistory,
              initialTrackedSteps: continuation.trackedSteps
            }
          : {}),
        allowDirectAnswerHandoff:
          Boolean(this.activeForcedToolName) || this.allowDirectAnswerHandoff,
        callModel: async (messages, tools, options) => {
          // Intermediate text is buffered until a final text-only response.
          return this.callAgentModel(
            messages,
            agentSystemPrompt,
            tools,
            options
          )
        },
        executeFunction: async (callable, toolInput) => {
          const toolResult = await runToolExecution(
            callable.toolkitId,
            callable.toolId,
            callable.functionName,
            toolInput,
            undefined,
            callable.qualifiedName
          )

          return {
            execution: toolResult.execution,
            ...(toolResult.handoffSignal
              ? { handoffSignal: toolResult.handoffSignal }
              : {})
          }
        },
        loadToolkitContext: (toolkitId) =>
          buildToolkitContextSection(caller, toolkitId),
        loadAgentSkill:
          SkillDomainHelper.getAgentSkillExecutionContext.bind(
            SkillDomainHelper
          ),
        onAgentSkillLoaded: (context) => {
          caller.setAgentSkillContext(context)
          emitActiveAgentSkillActivity()
        },
        onPlanUpdated: (steps) => {
          trackedSteps = steps.map((step) => ({ ...step }))
          emitPlanWidget(
            trackedSteps,
            null,
            planWidgetIdValue,
            hasPlanningWidget
          )
          hasPlanningWidget = true
        }
      })

      executionHistory.push(...result.executionHistory)
      trackedSteps = result.trackedSteps.map((step) => ({ ...step }))
      this.hasExplicitMemoryWrite = executionHistory.some(
        (execution) =>
          execution.status === 'success' &&
          execution.function === 'structured_knowledge.memory.write'
      )

      if (result.intent === 'clarification') {
        this.saveAgentLoopContinuation(
          createAgentLoopContinuationState({
            originalInput,
            clarificationQuestion: result.answer,
            planWidgetId: planWidgetIdValue,
            trackedSteps,
            executionHistory,
            loadedToolkitIds: catalog.loadedToolkitIds
          })
        )
      }

      return finalize(result.answer, result.intent)
    } catch (error) {
      LogHelper.title(this.name)
      LogHelper.error(`Failed to execute: ${String(error)}`)
      return null
    }
  }

  private async loadPreparedHistory(): Promise<PreparedAgentHistory> {
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

  private getHistoryCompactionScope(): AgentHistoryCompactionScope {
    return isLocalLLMProvider(getLLMProviderName())
      ? 'local'
      : 'remote'
  }

  private getHistoryCompactionConfig(): AgentHistoryCompactionConfig {
    if (isLocalLLMProvider(getLLMProviderName())) {
      return {
        historyLimit: AGENT_LOCAL_PROVIDER_HISTORY_LOGS,
        compactionBatchSize: AGENT_LOCAL_PROVIDER_HISTORY_COMPACTION_POINT
      }
    }

    return {
      historyLimit: AGENT_REMOTE_PROVIDER_HISTORY_LOGS,
      compactionBatchSize: AGENT_REMOTE_PROVIDER_HISTORY_COMPACTION_POINT
    }
  }

  private getSessionStateFilename(filename: string): string {
    const sessionId = getActiveConversationSessionId()

    if (!sessionId) {
      return filename
    }

    return `${filename}${AGENT_SESSION_STATE_FILENAME_SEPARATOR}${sessionId}`
  }

  private getContinuationStateStore(): ContextStateStore<AgentLoopContinuationState | null> {
    const filename = this.getSessionStateFilename(AGENT_CONTINUATION_STATE_FILENAME)
    const storeKey = `${getActiveProfileName()}:${filename}`
    const existingStore = ReActLLMDuty.continuationStateStores.get(storeKey)

    if (existingStore) {
      return existingStore
    }

    const store = new ContextStateStore<AgentLoopContinuationState | null>(
      filename,
      null
    )

    ReActLLMDuty.continuationStateStores.set(storeKey, store)

    return store
  }

  private getHistoryCompactionStateStore(): ContextStateStore<AgentHistoryCompactionState> {
    const filename = this.getSessionStateFilename(
      AGENT_HISTORY_COMPACTION_STATE_FILENAME
    )
    const storeKey = `${getActiveProfileName()}:${filename}`
    const existingStore = ReActLLMDuty.historyCompactionStateStores.get(storeKey)

    if (existingStore) {
      return existingStore
    }

    const store = new ContextStateStore<AgentHistoryCompactionState>(
      filename,
      AGENT_HISTORY_COMPACTION_STATE_FALLBACK
    )

    ReActLLMDuty.historyCompactionStateStores.set(storeKey, store)

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
    scope: AgentHistoryCompactionScope
  ): AgentHistoryCompactionProviderState {
    const persistedState = this.getHistoryCompactionStateStore().load()
    return this.normalizeHistoryCompactionProviderState(persistedState?.[scope])
  }

  private normalizeHistoryCompactionProviderState(
    value: unknown
  ): AgentHistoryCompactionProviderState {
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
    scope: AgentHistoryCompactionScope,
    providerState: AgentHistoryCompactionProviderState
  ): void {
    const persistedState = this.getHistoryCompactionStateStore().load()
    const nextState: AgentHistoryCompactionState = {
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
    state: AgentHistoryCompactionProviderState
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
    left: AgentHistoryCompactionProviderState,
    right: AgentHistoryCompactionProviderState
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
    currentState: AgentHistoryCompactionProviderState
  ): AgentHistoryCompactionProviderState {
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
    currentState: AgentHistoryCompactionProviderState
  ): {
    state: AgentHistoryCompactionProviderState
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

    const synchronizedState: AgentHistoryCompactionProviderState = {
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
    state: AgentHistoryCompactionProviderState,
    config: AgentHistoryCompactionConfig
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
    synchronizedState: AgentHistoryCompactionProviderState
  ): AgentHistoryCompactionProviderState {
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
    state: AgentHistoryCompactionProviderState,
    config: AgentHistoryCompactionConfig
  ): Promise<AgentHistoryCompactionProviderState | null> {
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
    state: AgentHistoryCompactionProviderState
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

  private buildPreparedHistory(history: MessageLog[]): PreparedAgentHistory {
    return {
      messageLogs: history
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
      systemPrompt: AGENT_HISTORY_COMPACTION_SYSTEM_PROMPT,
      temperature: 0,
      disableThinking: true,
      trackProviderErrors: false
    }

    const maxTokenBudgets = [
      AGENT_HISTORY_COMPACTION_MAX_TOKENS,
      AGENT_HISTORY_COMPACTION_RETRY_MAX_TOKENS
    ]

    for (const maxTokens of maxTokenBudgets) {
      try {
        const result = await LLM_PROVIDER.prompt(prompt, {
          ...baseCompletionParams,
          maxTokens
        })

        const normalized = normalizeHistoryCompactionSummary(result?.output)
        if (normalized && hasHistoryCompactionContent(normalized)) {
          return normalized
        }

        if (maxTokens !== maxTokenBudgets[maxTokenBudgets.length - 1]) {
          LogHelper.title(this.name)
          LogHelper.warning(
            `History compaction returned invalid structured output; retrying with maxTokens=${AGENT_HISTORY_COMPACTION_RETRY_MAX_TOKENS}`
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
          `History compaction attempt failed; retrying with maxTokens=${AGENT_HISTORY_COMPACTION_RETRY_MAX_TOKENS}: ${String(error)}`
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

  /** Appends trusted integration guidance without changing the shared loop. */
  private appendAdditionalInstructions(systemPrompt: string): string {
    if (!this.additionalInstructions) {
      return systemPrompt
    }

    return [
      systemPrompt,
      '',
      '<additional_instructions>',
      this.additionalInstructions,
      '</additional_instructions>'
    ].join('\n')
  }

  /**
   * Adds stable turn-level grounding to the first user message. Subsequent
   * agent calls reuse this message and append tool protocol messages only.
   */
  private async buildAgentRequest(
    caller: LLMCaller,
    input: string
  ): Promise<string> {
    const sections = [
      '<user_request>',
      input,
      '</user_request>',
      '',
      '<context_manifest>',
      caller.getContextManifest(),
      '</context_manifest>',
      '',
      '<self_model>',
      caller.getSelfModelSnapshot(),
      '</self_model>'
    ]

    if (caller.agentSkillCatalog.trim()) {
      sections.push(
        '',
        '<available_agent_skills>',
        caller.agentSkillCatalog,
        '</available_agent_skills>'
      )
    }

    if (caller.agentSkillContext) {
      sections.push(
        '',
        '<active_agent_skill>',
        `Name: ${caller.agentSkillContext.name}`,
        `Path: ${caller.agentSkillContext.skillPath}`,
        '',
        caller.agentSkillContext.instructions,
        '</active_agent_skill>'
      )
    }

    if (caller.getPreviousToolArtifacts) {
      try {
        const previousToolArtifacts =
          await caller.getPreviousToolArtifacts()
        if (previousToolArtifacts.trim()) {
          sections.push(
            '',
            '<previous_tool_artifacts>',
            'These artifacts come from earlier turns, not the current agent transcript.',
            previousToolArtifacts,
            '</previous_tool_artifacts>'
          )
        }
      } catch (error) {
        LogHelper.title(this.name)
        LogHelper.warning(
          `Failed to load previous tool artifacts: ${String(error)}`
        )
      }
    }

    return sections.join('\n')
  }

  private loadValidAgentLoopContinuation(): AgentLoopContinuationState | null {
    const state = this.getContinuationStateStore().load()
    if (!state) {
      return null
    }

    if (!isAgentLoopContinuationStateValid(state)) {
      this.getContinuationStateStore().save(null)
      return null
    }

    return state
  }

  private saveAgentLoopContinuation(state: AgentLoopContinuationState): void {
    this.getContinuationStateStore().save(state)
  }

  private consumeAgentLoopContinuation(): AgentLoopContinuationState | null {
    const state = this.loadValidAgentLoopContinuation()
    if (!state) {
      return null
    }

    this.getContinuationStateStore().save(null)
    return state
  }

  // ---------------------------------------------------------------------------
  // LLM calling helpers
  // ---------------------------------------------------------------------------

  /** Provides the stable context and skill callbacks used by the agent loop. */
  private createLLMCaller(): LLMCaller {
    const getActiveAgentSkillContext = (): AgentSkillContext | null =>
      this.activeAgentSkillContext
    const setActiveAgentSkillContext = (context: AgentSkillContext): void => {
      this.activeAgentSkillContext = context
    }

    return {
      get agentSkillContext(): AgentSkillContext | null {
        return getActiveAgentSkillContext()
      },
      agentSkillCatalog: SkillDomainHelper.getAgentSkillCatalogContentSync(),
      setAgentSkillContext: setActiveAgentSkillContext,
      getContextFileContent: CONTEXT_MANAGER.getContextFileContent.bind(
        CONTEXT_MANAGER
      ),
      getContextManifest: CONTEXT_MANAGER.getManifest.bind(CONTEXT_MANAGER),
      getSelfModelSnapshot:
        SELF_MODEL_MANAGER.getSnapshot.bind(SELF_MODEL_MANAGER),
      getPreviousToolArtifacts:
        TOOL_CALL_LOGGER.getRecentArtifactManifest.bind(TOOL_CALL_LOGGER)
    }
  }

  private async callAgentModel(
    transcript: AgentToolTranscriptMessage[],
    systemPrompt: string,
    tools: OpenAITool[],
    options: {
      isRecoveryAttempt: boolean
      isFinalizationAttempt?: boolean
      isContextRecoveryAttempt?: boolean
      remainingIterations?: number
    }
  ): Promise<{
    toolCalls?: OpenAIToolCall[]
    textContent?: string
    isTruncated?: boolean
  } | null> {
    const phase: AgentPhase = options.isFinalizationAttempt
      ? 'final_answer'
      : 'agent'
    const activeSystemPrompt = [
      systemPrompt,
      ...(options.remainingIterations !== undefined
        ? [buildAgentConvergenceSystemPrompt(options.remainingIterations)]
        : []),
      ...(options.isFinalizationAttempt
        ? [AGENT_LIMIT_FINALIZATION_SYSTEM_PROMPT]
        : [])
    ].join('\n\n')
    const providerName = getLLMProviderName()
    const contextCompactionTriggerTokens = options.isContextRecoveryAttempt
      ? resolveAgentContextRecoveryTriggerTokens(providerName)
      : resolveAgentContextCompactionTriggerTokens(providerName)
    const preparedContext = prepareAgentModelContext({
      transcript,
      systemPrompt: activeSystemPrompt,
      tools,
      compactionTriggerTokens: contextCompactionTriggerTokens,
      forceCompaction:
        options.isRecoveryAttempt || Boolean(options.isFinalizationAttempt)
    })
    if (
      preparedContext.estimatedInputTokens > contextCompactionTriggerTokens
    ) {
      throw new AgentModelProviderError(
        `Agent context remains above its ${contextCompactionTriggerTokens}-token target after compaction.`,
        !options.isContextRecoveryAttempt
      )
    }
    const preparedTranscript = preparedContext.transcript
    const preparedTools = preparedContext.tools
    const promptForLog = this.safeJSONStringify(preparedTranscript)
    const completionStartedAt = Date.now()
    const inferencePolicy = getAgentInferencePolicy()
    const modelSettings = CONFIG_STATE
      .getModelSettingsState()
      .getSettings(CONFIG_STATE.getModelState().getAgentTarget())
    const configuredReasoning = modelSettings.reasoning
    const reasoningMode =
      options.isRecoveryAttempt || options.isFinalizationAttempt
      ? 'off'
      : configuredReasoning === 'auto'
        ? inferencePolicy.reasoningMode
        : configuredReasoning === 'none'
          ? 'off'
          : 'on'
    const reasoningEffort =
      options.isRecoveryAttempt || options.isFinalizationAttempt ||
      configuredReasoning === 'auto' || configuredReasoning === 'on'
        ? undefined
        : configuredReasoning
    const reasoningUseDefaultEffort =
      !options.isRecoveryAttempt &&
      !options.isFinalizationAttempt &&
      configuredReasoning === 'on'
    const serviceTier = modelSettings.speed === 'fast'
      ? 'priority'
      : modelSettings.speed === 'normal'
        ? 'default'
        : undefined
    const disableThinking = reasoningMode === 'off'
    const shouldEmitReasoning =
      reasoningMode !== 'off' && inferencePolicy.emitReasoning

    const toolNames = preparedTools.map((t) => t.function.name).join(', ')
    const reasoningGenerationId = shouldEmitReasoning
      ? this.getReasoningGenerationId(
          phase,
          StringHelper.random(6, { onlyLetters: true })
        )
      : null

    this.logTitle(phase)
    LogHelper.debug(`callAgentModel: tools=[${toolNames}] | choice=auto`)
    if (preparedContext.wasCompacted) {
      LogHelper.debug(
        `callAgentModel: bounded context prepared | est_tokens=${preparedContext.estimatedInputTokens} | exchanges=${preparedContext.compactedToolExchangeCount} | tools=${tools.length}->${preparedTools.length} | recovery=${options.isRecoveryAttempt} | finalization=${Boolean(options.isFinalizationAttempt)}`
      )
    }
    this.logAgentPromptDispatch({
      prompt: promptForLog,
      systemPrompt: activeSystemPrompt,
      tools: preparedTools,
      phasePolicySummary: formatAgentInferencePolicyForLog({
        ...inferencePolicy,
        reasoningMode,
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(serviceTier ? { serviceTier } : {}),
        emitReasoning: shouldEmitReasoning
      }),
      shouldStream: inferencePolicy.streamToProvider
    })

    let completionResult: Awaited<ReturnType<typeof LLM_PROVIDER.prompt>>
    let completed = false
    let waitNoticeTimer: NodeJS.Timeout | null = null
    let diagnosisTimer: NodeJS.Timeout | null = null
    let diagnosisRetryTimer: NodeJS.Timeout | null = null
    const toolCallAbortController = new AbortController()

    const delayReason = this.buildLongToolCallReason(
      promptForLog,
      activeSystemPrompt,
      preparedTools
    )

    waitNoticeTimer = setTimeout(() => {
      if (completed) {
        return
      }
      this.logTitle(phase)
      LogHelper.warning(
        `callAgentModel: pending > ${AGENT_TOOL_CALL_WAIT_NOTICE_DELAY_MS}ms`
      )
      void this.emitProgress(
        BRAIN.wernicke('react.tool_call.waiting', '', {
          '{{ reason }}': delayReason
        })
      )
    }, AGENT_TOOL_CALL_WAIT_NOTICE_DELAY_MS)

    diagnosisTimer = setTimeout(() => {
      if (completed) {
        return
      }

      void this.runLongToolCallDiagnosis(
        promptForLog,
        activeSystemPrompt,
        preparedTools
      )

      diagnosisRetryTimer = setTimeout(() => {
        if (completed || toolCallAbortController.signal.aborted) {
          return
        }

        const abortReason: LLMPromptAbortReason = {
          shouldRetry: true,
          retryStrategy: 'timeout',
          source: 'agent_tool_call_diagnosis',
          delayMs: AGENT_TOOL_CALL_DIAGNOSIS_RETRY_DELAY_MS
        }

        this.logTitle(phase)
        LogHelper.warning(
          `callAgentModel: diagnosis grace period exceeded (${AGENT_TOOL_CALL_DIAGNOSIS_RETRY_DELAY_MS}ms); canceling in-flight request and retrying`
        )

        toolCallAbortController.abort(abortReason)
      }, AGENT_TOOL_CALL_DIAGNOSIS_RETRY_DELAY_MS)
    }, AGENT_TOOL_CALL_DIAGNOSIS_DELAY_MS)

    try {
      completionResult = await LLM_PROVIDER.prompt(preparedTranscript, {
        dutyType: LLMDuties.ReAct,
        systemPrompt: activeSystemPrompt,
        temperature: AGENT_TEMPERATURE,
        timeout: AGENT_INFERENCE_TIMEOUT_MS,
        maxRetries: AGENT_TIMEOUT_MAX_RETRIES,
        maxTokens: resolveAgentMaxOutputTokens(
          providerName,
          preparedContext.estimatedInputTokens
        ),
        shouldStream: inferencePolicy.streamToProvider,
        promptCacheKey: AGENT_PROMPT_CACHE_KEY,
        ...(inferencePolicy.textVerbosity
          ? { textVerbosity: inferencePolicy.textVerbosity }
          : {}),
        ...(shouldEmitReasoning && inferencePolicy.reasoningSummary
          ? { reasoningSummary: inferencePolicy.reasoningSummary }
          : {}),
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
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(reasoningUseDefaultEffort ? { reasoningUseDefaultEffort: true } : {}),
        ...(serviceTier ? { serviceTier } : {}),
        ...(disableThinking ? { disableThinking: true } : {}),
        tools: preparedTools,
        toolChoice: 'auto',
        signal: toolCallAbortController.signal
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
      LogHelper.debug('callAgentModel: no completion result returned')
      const providerError = LLM_PROVIDER.consumeLastProviderErrorMessage()
      if (providerError) {
        throw new AgentModelProviderError(
          providerError,
          !options.isContextRecoveryAttempt &&
            preparedContext.estimatedInputTokens >=
              resolveAgentContextRecoveryTriggerTokens(providerName)
        )
      }
      return null
    }

    const completionEndedAt = Date.now()
    const toolCalls = (
      completionResult as unknown as { toolCalls?: OpenAIToolCall[] }
    ).toolCalls
    const observedPhase: AgentPhase =
      !toolCalls || toolCalls.length === 0 ? 'final_answer' : phase
    this.observeCompletionMetrics({
      phase: observedPhase,
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

    if (toolCalls && toolCalls.length > 0) {
      const allowedToolNames = new Set(
        preparedTools.map((t) => t.function.name)
      )
      const normalizedToolCalls = toolCalls.map((toolCall) => {
        const normalizedName = this.resolveAllowedToolCallName(
          toolCall.function.name,
          allowedToolNames
        )

        if (!normalizedName || normalizedName === toolCall.function.name) {
          return toolCall
        }

        return {
          ...toolCall,
          function: {
            ...toolCall.function,
            name: normalizedName
          }
        }
      })
      this.logTitle(phase)
      LogHelper.debug(
        `callAgentModel: ${normalizedToolCalls.length} tool call(s) received`
      )
      const textContent =
        typeof completionResult.output === 'string'
          ? completionResult.output
          : ''
      return {
        toolCalls: normalizedToolCalls,
        textContent,
        ...(completionResult.finishReason !== undefined
          ? {
              isTruncated: this.isTruncatedFinishReason(
                completionResult.finishReason
              )
            }
          : {})
      }
    }

    const textContent =
      typeof completionResult.output === 'string'
        ? completionResult.output
        : ''
    this.logTitle(phase)
    LogHelper.debug(
      `callAgentModel: final text response received (${textContent.length} chars)`
    )
    return {
      textContent,
      ...(completionResult.finishReason !== undefined
        ? {
            isTruncated: this.isTruncatedFinishReason(
              completionResult.finishReason
            )
          }
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

  private isTruncatedFinishReason(finishReason: string): boolean {
    return TRUNCATED_COMPLETION_FINISH_REASONS.has(
      finishReason.toLowerCase()
    )
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

  private buildLogTitle(context?: string): string {
    return context ? `${this.name} / ${context}` : this.name
  }

  private logTitle(context?: string): void {
    LogHelper.title(this.buildLogTitle(context))
  }

  private writeAgentPromptLog(params: {
    systemPrompt: string
    prompt: string
    tools: OpenAITool[]
    phasePolicySummary?: string
    shouldStream?: boolean
  }): void {
    try {
      const agentPromptsLogPath = path.join(getProfilePaths().logs, 'prompts')

      fs.mkdirSync(agentPromptsLogPath, { recursive: true })

      const promptLogFilePath = path.join(
        agentPromptsLogPath,
        'agent.log'
      )
      const headerLines = [
        `=== ${new Date().toISOString()} ===`,
        'phase=agent',
        'channel=tools',
        `stream=${params.shouldStream === true ? 'true' : 'false'}`,
        ...(params.phasePolicySummary
          ? [`policy=${params.phasePolicySummary}`]
          : []),
        `tool_count=${params.tools.length}`,
        'tool_choice=auto',
        ''
      ]
      const sectionLines = [
        '--- SYSTEM_PROMPT ---',
        StringHelper.redactSecrets(params.systemPrompt),
        '',
        '--- AGENT_TRANSCRIPT ---',
        StringHelper.redactSecrets(params.prompt),
        ''
      ]

      if (params.tools.length > 0) {
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
      this.logTitle('agent')
      LogHelper.warning(
        `Failed to write prompt log file: ${String(error)}`
      )
    }
  }

  private logAgentPromptDispatch(params: {
    prompt: string
    systemPrompt: string
    phasePolicySummary?: string
    tools: OpenAITool[]
    shouldStream?: boolean
  }): void {
    const promptTokens = this.estimateTokensFromText(params.prompt)
    const systemTokens = this.estimateTokensFromText(params.systemPrompt)
    const toolsTokens = this.estimateTokensFromText(
      this.safeJSONStringify(params.tools)
    )
    const totalEstimated = promptTokens + systemTokens + toolsTokens

    this.logTitle('agent')
    LogHelper.debug(
      `Prompt dispatch [tools] est_tokens=${totalEstimated} (transcript=${promptTokens}, system=${systemTokens}, tools=${toolsTokens})${
        params.shouldStream === true ? ' | stream=true' : ''
      }${
        params.phasePolicySummary ? ` | ${params.phasePolicySummary}` : ''
      } | tools=${params.tools.length} | tool_choice=auto`
    )
    this.writeAgentPromptLog({
      systemPrompt: params.systemPrompt,
      prompt: params.prompt,
      tools: params.tools,
      ...(params.phasePolicySummary !== undefined
        ? { phasePolicySummary: params.phasePolicySummary }
        : {}),
      ...(params.shouldStream !== undefined
        ? { shouldStream: params.shouldStream }
        : {})
    })
  }

  private logPromptUsage(
    phase: AgentPhase,
    usedInputTokens: number,
    usedOutputTokens: number
  ): void {
    this.logTitle(phase)
    LogHelper.debug(
      `Prompt usage [tools] input=${usedInputTokens} output=${usedOutputTokens} | total=${this.totalInputTokens}+${this.totalOutputTokens}=${this.totalInputTokens + this.totalOutputTokens}`
    )
  }

  private observeCompletionMetrics(params: {
    phase: AgentPhase
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
        completionCount: this.completionCount,
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
      estimateTokensFromText: this.estimateTokensFromText.bind(this)
    })
    this.completionCount = observedMetrics.accumulator.completionCount
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
      params.usedInputTokens ?? 0,
      params.usedOutputTokens ?? 0
    )
    this.logPromptReasoning(params.phase, params.reasoning)
  }

  private logPromptReasoning(
    phase: AgentPhase,
    reasoning?: string
  ): void {
    this.logTitle(phase)
    if (reasoning && reasoning.trim()) {
      LogHelper.debug(`Prompt reasoning [tools]:\n${reasoning.trim()}`)
      return
    }

    LogHelper.debug('Prompt reasoning [tools]: none')
  }

  private buildLongToolCallReason(
    prompt: string,
    systemPrompt: string,
    tools: OpenAITool[]
  ): string {
    const estimatedPromptTokens =
      this.estimateTokensFromText(prompt) +
      this.estimateTokensFromText(systemPrompt) +
      this.estimateTokensFromText(JSON.stringify(tools))

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
    tools: OpenAITool[]
  ): Promise<void> {
    const promptTokens =
      this.estimateTokensFromText(prompt) +
      this.estimateTokensFromText(systemPrompt)
    const toolSchemaTokens = this.estimateTokensFromText(JSON.stringify(tools))
    const totalEstimatedTokens = promptTokens + toolSchemaTokens

    const diagnosisMessage = BRAIN.wernicke('react.tool_call.diagnosis', '', {
      '{{ provider }}': getLLMProviderName(),
      '{{ tool_choice }}': 'auto',
      '{{ tool_count }}': String(tools.length),
      '{{ total_tokens }}': String(totalEstimatedTokens),
      '{{ prompt_tokens }}': String(promptTokens),
      '{{ tool_tokens }}': String(toolSchemaTokens),
      '{{ history_tokens }}': '0'
    })

    this.logTitle('execution')
    LogHelper.warning(
      `Long tool-call diagnosis (> ${AGENT_TOOL_CALL_DIAGNOSIS_DELAY_MS}ms): ${diagnosisMessage}`
    )

    await this.emitProgress(diagnosisMessage)
  }

  private async emitProgress(message: string): Promise<void> {
    if (!message) {
      return
    }

    try {
      SOCKET_SERVER.emitAnswerToChatClients({
        id: `agent-progress-${StringHelper.random(8, { onlyLetters: true })}`,
        answer: message,
        fallbackText: message,
        historyMode: 'system_widget'
      })
    } catch (error) {
      this.logTitle('execution')
      LogHelper.warning(
        `Failed to emit intermediate progress message: ${String(error)}`
      )
    }
  }

  private makeDutyResult(output: string): LLMDutyResult {
    if (!this.hasFinalizedAnswer) {
      throw new Error(
        'Agent invariant violation: user-facing output must be finalized before creating a duty result.'
      )
    }

    const normalizedOutput = StringHelper.normalizeUserFacingText(output)

    if (normalizedOutput?.trim()) {
      this.emitSyntheticTokenStream(normalizedOutput)
    }

    this.logTitle('final_answer')
    LogHelper.success('Duty executed')
    LogHelper.success(`Output — ${normalizedOutput}`)
    LogHelper.debug(
      `Total tokens — input: ${this.totalInputTokens} | output: ${this.totalOutputTokens} | combined: ${this.totalInputTokens + this.totalOutputTokens}`
    )

    const llmMetrics = deriveLLMMetrics({
      completionCount: this.completionCount,
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
      estimateTokensFromText: this.estimateTokensFromText.bind(this)
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
    phase: AgentPhase,
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
    phase: AgentPhase
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

    for (const token of chunks) {
      SOCKET_SERVER.emitToChatClients('llm-token', {
        token,
        generationId
      })
    }
  }
}
