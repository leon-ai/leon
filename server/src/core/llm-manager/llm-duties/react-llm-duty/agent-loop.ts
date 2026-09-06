import { TOOLKIT_REGISTRY } from '@/core'
import type {
  AgentToolTranscriptMessage,
  OpenAITool,
  OpenAIToolCall
} from '@/core/llm-manager/types'
import type { MessageLog } from '@/types'

import type {
  AgentSkillContext,
  ExecutionRecord,
  FinalResponseSignal,
  FinalPhaseIntent,
  FunctionConfig,
  PlanStepStatus,
  ToolExecutionResult,
  TrackedPlanStep
} from './types'
import { findDuplicateToolInputMatch } from './agent-helpers'
import {
  AGENT_CONVERGENCE_RESERVE_ITERATIONS,
  AGENT_MAX_PARALLEL_TOOL_CALLS,
  AGENT_MAX_ITERATIONS,
  AGENT_TOOL_CALL_TITLE_ARGUMENT_NAME,
  AGENT_TOOL_CALL_TITLE_MAX_CHARS
} from './constants'
import { buildComputerUseConvergenceHint } from './computer-use-convergence'
import { validateToolInput } from './utils'

export const AGENT_PLAN_TOOL_NAME = 'update_plan'
export const AGENT_CLARIFICATION_TOOL_NAME = 'request_clarification'
export const AGENT_SKILL_TOOL_NAME = 'load_agent_skill'
export const AGENT_TOOLKIT_LOADER_NAME = 'load_toolkit'

const AGENT_TOOL_NAME_SEPARATOR = '__'

export const AGENT_SYSTEM_PROMPT = `You are an autonomous agent with tools.

<agent_loop>
- Work directly from the user request and the complete conversation transcript.
- When a tool can advance the request, call it now. Do not describe a future action without taking it.
- Tool calls and tool results from this run are already present in the transcript. Never use memory, context, or filesystem tools to rediscover what happened in the current run.
- Large tool results may include a preview and output_log_path. Read only the needed artifact section when the preview does not contain the required fact.
- Treat tool errors as observations: correct the arguments, choose another available tool, or explain the blocker.
- Continue until the requested deliverable is complete and verified. When complete, return the final user-facing answer as plain text with no tool call.
- Call request_clarification with one concise question only when required information cannot be obtained with available tools.
</agent_loop>

<tool_policy>
- Use only the provided tools.
- For every executable toolkit call, set ${AGENT_TOOL_CALL_TITLE_ARGUMENT_NAME} to a very short, action-specific title that explains the immediate goal and includes the key target when useful.
- Load the most specific relevant toolkit before acting. Prefer a dedicated toolkit over a general operating-system toolkit when both could perform the task.
- Prefer dedicated/API tools, then semantic OS tools. Use a bounded shell command for non-visual system work when no dedicated tool fits. Use computer use for graphical application launch or control, visible UI state, and visual verification. Observe before acting. For a low-risk, reversible action, a successful tool result is sufficient unless it reports failure or a suspected no-op; add verification only when ambiguity or consequences justify it.
- When the owner provides a source to understand, prefer direct-source tools over secondary search. Use search as fallback when the source cannot be accessed or does not contain the needed evidence.
- Use the exact observed values from earlier tool results when chaining calls.
- Do not repeat an identical call when its result is already in the transcript.
- Use update_plan only when a visible plan materially helps a multi-step task. It is optional.
- If you create a plan, update its statuses as work advances and complete its final statuses before answering.
- If an Agent Skill is relevant, load it before executing the specialized workflow and follow its instructions.
- Context and memory tools provide external knowledge. They are not substitutes for the agent transcript.
- For claims about past conversations, use raw session search when memory is inconclusive or exact evidence matters. Treat memory results as search clues; when a candidate entity appears, search it with alternative wording for the relationship being verified. Prefer owner-authored evidence for facts about the owner.
</tool_policy>

<safety>
- Verify required paths, identifiers, accepted values, and prerequisites before side effects.
- Do not invent current, exact, mutable, environment-specific, or tool-produced facts.
- Stop and explain a genuine blocker rather than fabricating a result.
- Never use computer or browser automation to hide automation, spoof identity, bypass CAPTCHA or anti-bot controls, or evade a service's usage policy.
</safety>

<response_policy>
- Keep the final answer proportionate and concise by default.
- Use plain text rather than Markdown syntax.
- Refer to yourself in the first person.
- Wrap every file path as [FILE_PATH]/path[/FILE_PATH].
</response_policy>`

export const AGENT_LIMIT_FINALIZATION_SYSTEM_PROMPT = `<execution_limit_checkpoint>
The operational iteration budget is exhausted. Address the original owner request now using the evidence already present in the transcript.

- No tools are available in this checkpoint. Return plain text only.
- If the evidence is sufficient, return the complete user-facing answer as plain text with no tool call.
- Do not claim completion when required evidence or work is still missing.
- If work is still incomplete, state the concrete obstacle and what remains unfinished. Do not claim that an alternative deliverable satisfies the original request.
- If genuinely missing information or authorization blocks completion, explain it in your answer. An internal execution limit is not a reason to ask the owner to approve the same task again.
</execution_limit_checkpoint>`

/** Adds lightweight convergence pressure near the hard iteration boundary. */
export function buildAgentConvergenceSystemPrompt(
  remainingIterations: number
): string {
  return `<execution_convergence>
${remainingIterations} operational iteration(s) remain before the final synthesis checkpoint.

- Consolidate the evidence already collected and stop broadening the task.
- Perform only checks that are decisive for the requested deliverable.
- Do not reread an artifact when its existing preview or an earlier range contains the needed fact.
- Return the completed owner-facing result as soon as it is supported.
</execution_convergence>`
}

export class AgentModelProviderError extends Error {
  public readonly canRetryWithCompaction: boolean

  constructor(message: string, canRetryWithCompaction: boolean) {
    super(message)
    this.name = 'AgentModelProviderError'
    this.canRetryWithCompaction = canRetryWithCompaction
  }
}

export interface AgentCallableFunction {
  qualifiedName: string
  toolkitId: string
  toolId: string
  functionName: string
  functionConfig: FunctionConfig
}

export interface AgentToolCatalog {
  tools: OpenAITool[]
  functionsByToolName: Map<string, AgentCallableFunction>
  availableToolkitsById: Map<string, AgentToolkitSummary>
  loadedToolkitIds: Set<string>
}

interface AgentToolkitSummary {
  id: string
  name: string
  description: string
  tools: string[]
}

interface AgentModelResult {
  textContent?: string
  toolCalls?: OpenAIToolCall[]
  isTruncated?: boolean
}

interface AgentModelCallOptions {
  isRecoveryAttempt: boolean
  isOutputRecoveryAttempt?: boolean
  isFinalizationAttempt?: boolean
  isContextRecoveryAttempt?: boolean
  remainingIterations?: number
}

type AgentFunctionExecutionResult = ToolExecutionResult

export interface AgentLoopParams {
  transcript: AgentToolTranscriptMessage[]
  catalog: AgentToolCatalog
  callModel: (
    transcript: AgentToolTranscriptMessage[],
    tools: OpenAITool[],
    options: AgentModelCallOptions
  ) => Promise<AgentModelResult | null>
  executeFunction: (
    callable: AgentCallableFunction,
    toolInput: string,
    toolCallTitle?: string
  ) => Promise<AgentFunctionExecutionResult>
  loadAgentSkill: (skillId: string) => Promise<AgentSkillContext | null>
  loadToolkitContext?: (toolkitId: string) => string
  onAgentSkillLoaded?: (context: AgentSkillContext) => void
  onPlanUpdated?: (steps: TrackedPlanStep[]) => void
  initialExecutionHistory?: ExecutionRecord[]
  initialTrackedSteps?: TrackedPlanStep[]
  allowDirectAnswerHandoff?: boolean
  maxIterations?: number
  finishingIterations?: number
  prepareContinuation?: (
    state: Pick<AgentLoopResult, 'transcript' | 'executionHistory' | 'trackedSteps'>
  ) => Promise<AgentToolTranscriptMessage[]>
}

export interface AgentLoopResult {
  answer: string
  intent: FinalPhaseIntent
  transcript: AgentToolTranscriptMessage[]
  executionHistory: ExecutionRecord[]
  trackedSteps: TrackedPlanStep[]
}

/**
 * Builds the initial agent catalog. Unforced turns progressively add exact
 * function schemas after the model selects a registry-backed toolkit.
 */
export function buildAgentToolCatalog(
  forcedToolName?: string | null,
  initiallyLoadedToolkitIds: Iterable<string> = [],
  progressiveToolkitLoading = true
): AgentToolCatalog {
  const tools: OpenAITool[] = []
  const functionsByToolName = new Map<string, AgentCallableFunction>()
  const availableToolkitsById = getAvailableToolkitSummaries()
  const loadedToolkitIds = new Set<string>()
  const catalog: AgentToolCatalog = {
    tools,
    functionsByToolName,
    availableToolkitsById,
    loadedToolkitIds
  }
  const forcedTool = forcedToolName
    ? TOOLKIT_REGISTRY.resolveToolById(forcedToolName)
    : null

  if (forcedToolName && !forcedTool) {
    return catalog
  }

  if (forcedTool) {
    loadToolkitFunctions(
      catalog,
      forcedTool.toolkitId,
      forcedTool.toolId
    )
    tools.push(createClarificationTool())
    return catalog
  }

  if (progressiveToolkitLoading && availableToolkitsById.size > 0) {
    tools.push(createToolkitLoaderTool(availableToolkitsById))
  }
  tools.push(
    createPlanTool(),
    createClarificationTool(),
    createAgentSkillTool()
  )

  // Eager mode is useful for a small profile allowlist where one extra
  // discovery inference costs more than exposing every available schema.
  // Progressive clarification resumes still restore only previously loaded
  // schemas because the transcript alone cannot make them callable.
  const toolkitIdsToLoad = progressiveToolkitLoading
    ? initiallyLoadedToolkitIds
    : availableToolkitsById.keys()
  for (const toolkitId of toolkitIdsToLoad) {
    loadToolkitFunctions(catalog, toolkitId)
  }

  return catalog
}

function getAvailableToolkitSummaries(): Map<string, AgentToolkitSummary> {
  const summaries = new Map<string, AgentToolkitSummary>()

  for (const tool of TOOLKIT_REGISTRY.getFlattenedTools()) {
    const toolSummary = `${tool.toolId}: ${tool.toolDescription}`
    const existingSummary = summaries.get(tool.toolkitId)
    if (existingSummary) {
      existingSummary.tools.push(toolSummary)
      continue
    }

    summaries.set(tool.toolkitId, {
      id: tool.toolkitId,
      name: tool.toolkitName,
      description: tool.toolkitDescription,
      tools: [toolSummary]
    })
  }

  return summaries
}

function loadToolkitFunctions(
  catalog: AgentToolCatalog,
  toolkitId: string,
  onlyToolId?: string
): number {
  let loadedFunctionCount = 0

  for (const tool of TOOLKIT_REGISTRY.getFlattenedTools()) {
    if (
      tool.toolkitId !== toolkitId ||
      (onlyToolId && tool.toolId !== onlyToolId)
    ) {
      continue
    }

    const functions = TOOLKIT_REGISTRY.getToolFunctions(
      tool.toolkitId,
      tool.toolId
    )
    if (!functions) {
      continue
    }

    for (const [functionName, functionConfig] of Object.entries(functions)) {
      const toolName = [tool.toolkitId, tool.toolId, functionName].join(
        AGENT_TOOL_NAME_SEPARATOR
      )
      if (catalog.functionsByToolName.has(toolName)) {
        continue
      }

      const qualifiedName = `${tool.toolkitId}.${tool.toolId}.${functionName}`
      catalog.functionsByToolName.set(toolName, {
        qualifiedName,
        toolkitId: tool.toolkitId,
        toolId: tool.toolId,
        functionName,
        functionConfig
      })
      catalog.tools.push({
        type: 'function',
        function: {
          name: toolName,
          description: `${qualifiedName}: ${functionConfig.description}`,
          parameters: addToolCallTitleParameter(functionConfig.parameters)
        }
      })
      loadedFunctionCount += 1
    }
  }

  if (loadedFunctionCount > 0) {
    catalog.loadedToolkitIds.add(toolkitId)
  }

  return loadedFunctionCount
}

/** Adds Leon-owned display metadata without changing the tool's input schema. */
function addToolCallTitleParameter(
  parameters: Record<string, unknown>
): Record<string, unknown> {
  const properties = parameters['properties']
  const required = parameters['required']
  const existingProperties =
    properties && typeof properties === 'object' && !Array.isArray(properties)
      ? properties as Record<string, unknown>
      : {}
  const existingRequired = Array.isArray(required)
    ? required.filter((value): value is string => typeof value === 'string')
    : []

  return {
    ...parameters,
    properties: {
      ...existingProperties,
      [AGENT_TOOL_CALL_TITLE_ARGUMENT_NAME]: {
        type: 'string',
        minLength: 1,
        maxLength: AGENT_TOOL_CALL_TITLE_MAX_CHARS,
        description:
          'Very short user-facing title describing the immediate goal of this tool call, including its key target when useful.'
      }
    },
    required: [
      ...existingRequired.filter(
        (name) => name !== AGENT_TOOL_CALL_TITLE_ARGUMENT_NAME
      ),
      AGENT_TOOL_CALL_TITLE_ARGUMENT_NAME
    ]
  }
}

/**
 * Converts persisted owner/Leon messages into the same transcript that will
 * receive agent tool calls. The current owner request is omitted when it was
 * already persisted because the caller appends its enriched form separately.
 */
export function buildAgentTranscriptHistory(
  history: MessageLog[],
  currentOwnerInput: string
): AgentToolTranscriptMessage[] {
  const messages = [...history]
  const lastMessage = messages[messages.length - 1]
  if (
    lastMessage?.who === 'owner' &&
    lastMessage.message.trim() === currentOwnerInput.trim()
  ) {
    messages.pop()
  }

  return messages.map((message) => ({
    role: message.who === 'owner' ? 'user' : 'assistant',
    content: message.message
  }))
}

/**
 * Runs the assistant/tool loop over one canonical transcript. Runtime
 * validation remains deterministic while failures are returned as tool-role
 */
export async function runAgentLoop(
  params: AgentLoopParams
): Promise<AgentLoopResult> {
  const transcript = params.transcript
  const executionHistory = (params.initialExecutionHistory || []).map(
    (execution) => ({ ...execution })
  )
  let trackedSteps = (params.initialTrackedSteps || []).map((step) => ({
    ...step
  }))
  const maxIterations = params.maxIterations ?? AGENT_MAX_ITERATIONS
  const finishingIterations = params.finishingIterations ?? 0
  let iterationLimit = maxIterations
  let hasUsedOutputRecovery = false
  let hasUsedContextRecovery = false

  for (let iteration = 0; iteration < iterationLimit; iteration += 1) {
    let modelResult: AgentModelResult | null
    let isRecoveryAttempt = false
    let isOutputRecoveryAttempt = false
    // Once a provider needs the smaller context target, keep that target for
    // the rest of the run instead of allowing the prompt to grow back.
    let isContextRecoveryAttempt = hasUsedContextRecovery
    const remainingIterations = iterationLimit - iteration

    while (true) {
      try {
        modelResult = await params.callModel(
          transcript,
          params.catalog.tools,
          {
            isRecoveryAttempt,
            ...(isOutputRecoveryAttempt ? { isOutputRecoveryAttempt: true } : {}),
            ...(isContextRecoveryAttempt
              ? { isContextRecoveryAttempt: true }
              : {}),
            ...(remainingIterations <= AGENT_CONVERGENCE_RESERVE_ITERATIONS
              ? { remainingIterations }
              : {})
          }
        )
      } catch (error) {
        if (
          error instanceof AgentModelProviderError &&
          error.canRetryWithCompaction &&
          !hasUsedContextRecovery
        ) {
          // Context pressure gets one smaller retry inside the same loop turn.
          hasUsedContextRecovery = true
          isRecoveryAttempt = true
          isContextRecoveryAttempt = true
          continue
        }

        if (hasUsedContextRecovery) {
          return createResumableAgentResult(
            'context',
            transcript,
            executionHistory,
            trackedSteps
          )
        }

        return {
          answer: `I could not continue because the model provider failed: ${String(error)}`,
          intent: 'error',
          transcript,
          executionHistory,
          trackedSteps
        }
      }
      if (!modelResult) {
        if (hasUsedContextRecovery) {
          return createResumableAgentResult(
            'context',
            transcript,
            executionHistory,
            trackedSteps
          )
        }

        return {
          answer: 'I could not continue because the model provider did not return a response.',
          intent: 'error',
          transcript,
          executionHistory,
          trackedSteps
        }
      }

      const hasUsableOutput =
        Boolean(modelResult.textContent?.trim()) ||
        Boolean(modelResult.toolCalls?.length)
      const shouldRecover = modelResult.isTruncated || !hasUsableOutput
      if (!shouldRecover || hasUsedOutputRecovery) {
        break
      }

      // Retry once without appending partial text or incomplete tool arguments.
      // Only an explicit length stop merits more output tokens, not an empty reply.
      hasUsedOutputRecovery = true
      isOutputRecoveryAttempt = Boolean(modelResult.isTruncated)
    }

    const emittedToolCalls = modelResult.toolCalls || []
    const toolCalls = emittedToolCalls.slice(
      0,
      AGENT_MAX_PARALLEL_TOOL_CALLS
    )
    const deferredToolCallCount = emittedToolCalls.length - toolCalls.length
    const textContent = modelResult.textContent?.trim() || ''
    if (modelResult.isTruncated) {
      return {
        answer:
          'The model reached its output limit before completing the response.',
        intent: 'error',
        transcript,
        executionHistory,
        trackedSteps
      }
    }
    if (toolCalls.length === 0) {
      if (textContent) {
        transcript.push({ role: 'assistant', content: textContent })
        return {
          answer: textContent,
          intent: 'answer',
          transcript,
          executionHistory,
          trackedSteps
        }
      }

      return {
        answer: 'I could not complete the request because the model returned an empty response.',
        intent: 'error',
        transcript,
        executionHistory,
        trackedSteps
      }
    }

    transcript.push({
      role: 'assistant',
      content: [
        textContent,
        ...(deferredToolCallCount > 0
          ? [
              `Runtime kept the first ${AGENT_MAX_PARALLEL_TOOL_CALLS} tool calls from this batch and deferred ${deferredToolCallCount}. Reassess the remaining work after these results.`
            ]
          : [])
      ]
        .filter(Boolean)
        .join('\n'),
      toolCalls
    })

    let terminalSignal: FinalResponseSignal | undefined
    for (const toolCall of toolCalls) {
      if (terminalSignal) {
        // Providers require one result for every emitted tool call. Complete
        // the protocol without running work after a terminal handoff.
        transcript.push({
          role: 'tool',
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          content: 'Tool call skipped because an earlier call ended this agent run.'
        })
        continue
      }

      const toolResult = await executeAgentToolCall(
        toolCall,
        params,
        executionHistory,
        trackedSteps
      )
      trackedSteps = toolResult.trackedSteps
      transcript.push({
        role: 'tool',
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        content: toolResult.content,
        ...(toolResult.files ? { files: toolResult.files } : {})
      })
      terminalSignal = toolResult.signal
    }

    if (terminalSignal) {
      return {
        answer: terminalSignal.draft,
        intent: terminalSignal.intent,
        transcript,
        executionHistory,
        trackedSteps
      }
    }

    // Continue an unfinished authorized run once, with bounded resume context.
    // This is a bounded finishing pass, not a new task or a renewed permission.
    if (iteration + 1 === maxIterations && finishingIterations > 0) {
      iterationLimit += finishingIterations
      if (params.prepareContinuation) {
        const checkpoint = await params.prepareContinuation({
          transcript,
          executionHistory,
          trackedSteps
        })
        transcript.splice(0, transcript.length, ...checkpoint)
      }
      transcript.push({
        role: 'user',
        content:
          '<execution_finishing_pass>Continue the already authorized task from the existing evidence and active skill. Finish and verify the requested deliverable; do not restart, broaden the task, or substitute a different workflow. Stop on a genuine blocker. This is the final bounded finishing pass.</execution_finishing_pass>'
      })
    }
  }

  return finalizeAgentLoopAtLimit(
    params,
    transcript,
    executionHistory,
    trackedSteps
  )
}

async function finalizeAgentLoopAtLimit(
  params: AgentLoopParams,
  transcript: AgentToolTranscriptMessage[],
  executionHistory: ExecutionRecord[],
  trackedSteps: TrackedPlanStep[]
): Promise<AgentLoopResult> {
  const primaryOutcome = await attemptAgentLimitFinalization(
    params,
    transcript
  )
  if (primaryOutcome) {
    transcript.push(...primaryOutcome.messages)
    return {
      answer: primaryOutcome.answer,
      intent: primaryOutcome.intent,
      transcript,
      executionHistory,
      trackedSteps
    }
  }

  return createResumableAgentResult(
    'synthesis',
    transcript,
    executionHistory,
    trackedSteps
  )
}

interface AgentLimitFinalizationOutcome {
  answer: string
  intent: 'answer'
  messages: AgentToolTranscriptMessage[]
}

async function attemptAgentLimitFinalization(
  params: AgentLoopParams,
  modelTranscript: AgentToolTranscriptMessage[]
): Promise<AgentLimitFinalizationOutcome | null> {
  let modelResult: AgentModelResult | null = null
  const options: AgentModelCallOptions = {
    isRecoveryAttempt: false,
    isFinalizationAttempt: true
  }
  // Final synthesis gets one retry too, using the remedy for the actual failure.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      modelResult = await params.callModel(modelTranscript, [], options)
    } catch (error) {
      if (!(error instanceof AgentModelProviderError) || !error.canRetryWithCompaction) {
        return null
      }
      options.isRecoveryAttempt = true
      options.isContextRecoveryAttempt = true
      continue
    }
    if (modelResult && !modelResult.isTruncated && modelResult.textContent?.trim()) {
      break
    }
    options.isOutputRecoveryAttempt = Boolean(modelResult?.isTruncated)
  }

  if (!modelResult || modelResult.isTruncated) {
    return null
  }

  const toolCalls = modelResult.toolCalls || []
  const textContent = modelResult.textContent?.trim() || ''
  if (toolCalls.length === 0) {
    return textContent
      ? {
          answer: textContent,
          intent: 'answer',
          messages: [{ role: 'assistant', content: textContent }]
        }
      : null
  }

  // A provider violating the text-only checkpoint must not execute more tools.
  return null
}

function createResumableAgentResult(
  failureKind: 'context' | 'synthesis',
  transcript: AgentToolTranscriptMessage[],
  executionHistory: ExecutionRecord[],
  trackedSteps: TrackedPlanStep[]
): AgentLoopResult {
  const answer = buildResumableAgentAnswer(failureKind)
  return {
    answer,
    intent: 'error',
    transcript,
    executionHistory,
    trackedSteps
  }
}

function buildResumableAgentAnswer(
  failureKind: 'context' | 'synthesis'
): string {
  return failureKind === 'context'
    ? 'I could not finish because the model could not process the collected information. The task is incomplete; the session retains the work done so far.'
    : 'I could not finish because the model failed to produce the final response. I cannot confirm that the task is complete. The session retains the work done so far.'
}

async function executeAgentToolCall(
  toolCall: OpenAIToolCall,
  params: AgentLoopParams,
  executionHistory: ExecutionRecord[],
  trackedSteps: TrackedPlanStep[]
): Promise<{
  content: string
  files?: NonNullable<ToolExecutionResult['modelFiles']>
  trackedSteps: TrackedPlanStep[]
  signal?: FinalResponseSignal
}> {
  if (toolCall.function.name === AGENT_TOOLKIT_LOADER_NAME) {
    const toolkitId = parseStringArgument(
      toolCall.function.arguments,
      'toolkit_id'
    )
    if (!toolkitId) {
      return {
        content: 'Toolkit load rejected: toolkit_id is required.',
        trackedSteps
      }
    }

    const toolkit = params.catalog.availableToolkitsById.get(toolkitId)
    if (!toolkit) {
      return {
        content: `Toolkit load rejected: "${toolkitId}" is not available.`,
        trackedSteps
      }
    }

    if (params.catalog.loadedToolkitIds.has(toolkitId)) {
      return {
        content: `Toolkit already loaded: ${toolkit.name}. Reuse its available functions.`,
        trackedSteps
      }
    }

    const loadedFunctionCount = loadToolkitFunctions(
      params.catalog,
      toolkitId
    )
    if (loadedFunctionCount === 0) {
      return {
        content: `Toolkit "${toolkit.name}" has no callable functions in the current runtime.`,
        trackedSteps
      }
    }

    const toolkitContext = params.loadToolkitContext?.(toolkitId).trim()
    return {
      content: [
        `Toolkit loaded: ${toolkit.name}. ${loadedFunctionCount} function schema(s) are available on the next model turn.`,
        ...(toolkitContext ? ['', toolkitContext] : [])
      ].join('\n'),
      trackedSteps
    }
  }

  if (toolCall.function.name === AGENT_CLARIFICATION_TOOL_NAME) {
    const question = parseStringArgument(
      toolCall.function.arguments,
      'question'
    )
    if (!question) {
      return {
        content: 'Clarification request rejected: question is required.',
        trackedSteps
      }
    }

    const explanation = parseStringArgument(
      toolCall.function.arguments,
      'explanation'
    )
    const alternatives = parseStringArrayArgument(
      toolCall.function.arguments,
      'alternatives'
    )
    const draft = [
      ...(explanation ? [explanation] : []),
      ...(alternatives.length > 0
        ? [
            [
              'Alternative options:',
              ...alternatives.map((alternative) => `- ${alternative}`)
            ].join('\n')
          ]
        : []),
      question
    ].join('\n\n')

    return {
      content: 'Clarification requested. Wait for the owner response.',
      trackedSteps,
      signal: {
        intent: 'clarification',
        draft
      }
    }
  }

  if (toolCall.function.name === AGENT_PLAN_TOOL_NAME) {
    const nextSteps = parsePlanSteps(toolCall.function.arguments)
    if (!nextSteps) {
      return {
        content: 'Plan update rejected: provide a valid steps array.',
        trackedSteps
      }
    }

    params.onPlanUpdated?.(nextSteps)
    return {
      content: 'Plan updated.',
      trackedSteps: nextSteps
    }
  }

  if (toolCall.function.name === AGENT_SKILL_TOOL_NAME) {
    const skillId = parseStringArgument(toolCall.function.arguments, 'skill_id')
    if (!skillId) {
      return {
        content: 'Agent Skill load rejected: skill_id is required.',
        trackedSteps
      }
    }

    let context: AgentSkillContext | null
    try {
      context = await params.loadAgentSkill(skillId)
    } catch (error) {
      return {
        content: `Agent Skill load failed: ${String(error)}`,
        trackedSteps
      }
    }
    if (!context) {
      return {
        content: `Agent Skill "${skillId}" is not available.`,
        trackedSteps
      }
    }

    params.onAgentSkillLoaded?.(context)
    return {
      content: [
        `Agent Skill loaded: ${context.name}`,
        `Skill path: ${context.skillPath}`,
        '',
        context.instructions
      ].join('\n'),
      trackedSteps
    }
  }

  const callable = params.catalog.functionsByToolName.get(
    toolCall.function.name
  )
  if (!callable) {
    return {
      content: `Tool call rejected: "${toolCall.function.name}" is not available.`,
      trackedSteps
    }
  }

  const toolCallInput = extractToolCallInput(toolCall.function.arguments)
  const validation = validateToolInput(
    toolCallInput.toolInput,
    callable.functionConfig.parameters
  )
  if (!validation.isValid) {
    return {
      content: `Tool input rejected for ${callable.qualifiedName}: ${validation.message || 'arguments do not match the schema'}`,
      trackedSteps
    }
  }

  const validatedInput =
    validation.repairedToolInput ?? toolCallInput.toolInput
  const duplicate =
    callable.functionConfig.deduplicate_calls === false
      ? null
      : findDuplicateToolInputMatch(
          executionHistory,
          callable.qualifiedName,
          callable.qualifiedName,
          validatedInput
        )
  if (duplicate) {
    return {
      content: `Duplicate call blocked: ${callable.qualifiedName} already ran with the same or an overlapping input in step ${duplicate.stepNumber}. Reuse its result from the transcript or request only the unread range.`,
      trackedSteps
    }
  }

  let execution: ExecutionRecord
  let modelFiles: ToolExecutionResult['modelFiles']
  let handoffSignal: FinalResponseSignal | undefined
  const executionStartedAt = Date.now()
  try {
    const result = await params.executeFunction(
      callable,
      validatedInput,
      toolCallInput.title
    )
    const executionCompletedAt = Date.now()
    execution = {
      ...result.execution,
      startedAt: executionStartedAt,
      completedAt: executionCompletedAt,
      durationMs: executionCompletedAt - executionStartedAt,
      ...(toolCallInput.title
        ? { toolCallTitle: toolCallInput.title }
        : {})
    }
    modelFiles = result.modelFiles
    handoffSignal = result.handoffSignal
  } catch (error) {
    // Tool failures stay inside the protocol so the model can recover using
    // the same transcript instead of aborting the whole agent turn.
    const executionCompletedAt = Date.now()
    execution = {
      function: callable.qualifiedName,
      status: 'error',
      observation: `Tool execution failed: ${String(error)}`,
      startedAt: executionStartedAt,
      completedAt: executionCompletedAt,
      durationMs: executionCompletedAt - executionStartedAt,
      ...(toolCallInput.title
        ? { toolCallTitle: toolCallInput.title }
        : {}),
      stepLabel: callable.qualifiedName,
      requestedToolInput: validatedInput
    }
  }

  executionHistory.push(execution)
  const convergenceHint = buildComputerUseConvergenceHint(executionHistory)
  const shouldHandoff =
    handoffSignal?.intent !== 'answer' || params.allowDirectAnswerHandoff

  return {
    content: [execution.observation, convergenceHint].filter(Boolean).join('\n\n'),
    ...(modelFiles ? { files: modelFiles } : {}),
    trackedSteps,
    ...(handoffSignal && shouldHandoff ? { signal: handoffSignal } : {})
  }
}

/** Separates Leon-owned display metadata from arguments sent to a tool. */
function extractToolCallInput(input: string): {
  toolInput: string
  title?: string
} {
  try {
    const parsed = JSON.parse(input) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { toolInput: input }
    }

    const record = parsed as Record<string, unknown>
    if (!(AGENT_TOOL_CALL_TITLE_ARGUMENT_NAME in record)) {
      return { toolInput: input }
    }

    const titleValue = record[AGENT_TOOL_CALL_TITLE_ARGUMENT_NAME]
    const toolArguments = { ...record }
    delete toolArguments[AGENT_TOOL_CALL_TITLE_ARGUMENT_NAME]

    if (typeof titleValue !== 'string' || !titleValue.trim()) {
      return { toolInput: JSON.stringify(toolArguments) }
    }

    const title = titleValue.trim()
    const boundedTitle = title.length <= AGENT_TOOL_CALL_TITLE_MAX_CHARS
      ? title
      : `${title.slice(0, AGENT_TOOL_CALL_TITLE_MAX_CHARS - 3).trimEnd()}...`

    return {
      toolInput: JSON.stringify(toolArguments),
      title: boundedTitle
    }
  } catch {
    return { toolInput: input }
  }
}

function parseStringArgument(input: string, key: string): string | null {
  try {
    const parsed = JSON.parse(input) as Record<string, unknown>
    const value = parsed[key]
    return typeof value === 'string' && value.trim() ? value.trim() : null
  } catch {
    return null
  }
}

function parseStringArrayArgument(input: string, key: string): string[] {
  try {
    const parsed = JSON.parse(input) as Record<string, unknown>
    if (!Array.isArray(parsed[key])) {
      return []
    }

    return parsed[key]
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function parsePlanSteps(input: string): TrackedPlanStep[] | null {
  try {
    const parsed = JSON.parse(input) as Record<string, unknown>
    if (!Array.isArray(parsed['steps']) || parsed['steps'].length === 0) {
      return null
    }

    const steps = parsed['steps'].flatMap((value) => {
      if (!value || typeof value !== 'object') {
        return []
      }

      const step = value as Record<string, unknown>
      const label = typeof step['label'] === 'string' ? step['label'].trim() : ''
      if (!label) {
        return []
      }

      return [
        {
          label,
          status: normalizePlanStepStatus(step['status'])
        }
      ]
    })

    return steps.length > 0 ? steps : null
  } catch {
    return null
  }
}

function normalizePlanStepStatus(value: unknown): PlanStepStatus {
  return value === 'in_progress' ||
    value === 'completed' ||
    value === 'error'
    ? value
    : 'pending'
}

function createPlanTool(): OpenAITool {
  return {
    type: 'function',
    function: {
      name: AGENT_PLAN_TOOL_NAME,
      description:
        'Create or replace the visible task plan for a complex multi-step request. This tool is optional and does not execute work.',
      parameters: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                label: {
                  type: 'string',
                  description: 'Short verb-first user-facing step label.'
                },
                status: {
                  type: 'string',
                  enum: ['pending', 'in_progress', 'completed', 'error']
                }
              },
              required: ['label', 'status'],
              additionalProperties: false
            }
          }
        },
        required: ['steps'],
        additionalProperties: false
      }
    }
  }
}

function createClarificationTool(): OpenAITool {
  return {
    type: 'function',
    function: {
      name: AGENT_CLARIFICATION_TOOL_NAME,
      description:
        'Pause the current agent run and ask the owner one required clarification question. When work remains incomplete, explain why and offer practical alternatives before asking whether to continue.',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'One concise question that unblocks the current task.'
          },
          explanation: {
            type: 'string',
            description:
              'Optional concise explanation of what remains incomplete and why.'
          },
          alternatives: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Optional practical alternatives available to the owner.'
          }
        },
        required: ['question'],
        additionalProperties: false
      }
    }
  }
}

function createToolkitLoaderTool(
  toolkitsById: Map<string, AgentToolkitSummary>
): OpenAITool {
  const toolkits = [...toolkitsById.values()]
  const toolkitCatalog = toolkits
    .map(
      (toolkit) =>
        `${toolkit.id}: ${toolkit.name} - ${toolkit.description} Tools: ${toolkit.tools.join('; ')}`
    )
    .join('\n')

  return {
    type: 'function',
    function: {
      name: AGENT_TOOLKIT_LOADER_NAME,
      description: [
        'Load the real function schemas for one relevant toolkit.',
        'Choose the most specific toolkit for the requested capability; use a general operating-system toolkit only when no dedicated toolkit fits.',
        'Available toolkits:',
        toolkitCatalog
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          toolkit_id: {
            type: 'string',
            enum: toolkits.map((toolkit) => toolkit.id),
            description: 'Exact toolkit id from the available toolkit catalog.'
          }
        },
        required: ['toolkit_id'],
        additionalProperties: false
      }
    }
  }
}

function createAgentSkillTool(): OpenAITool {
  return {
    type: 'function',
    function: {
      name: AGENT_SKILL_TOOL_NAME,
      description:
        'Load the complete instructions for one relevant Agent Skill before following its specialized workflow.',
      parameters: {
        type: 'object',
        properties: {
          skill_id: {
            type: 'string',
            description: 'Exact Agent Skill id from the available skills list.'
          }
        },
        required: ['skill_id'],
        additionalProperties: false
      }
    }
  }
}
