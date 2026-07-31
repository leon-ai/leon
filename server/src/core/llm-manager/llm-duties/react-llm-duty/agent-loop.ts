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
  TrackedPlanStep
} from './types'
import { findDuplicateToolInputMatch } from './agent-helpers'
import {
  AGENT_CONVERGENCE_RESERVE_ITERATIONS,
  AGENT_LIMIT_RECOVERY_EVIDENCE_MAX_CHARS,
  AGENT_LIMIT_RECOVERY_OBSERVATION_MAX_CHARS,
  AGENT_LIMIT_RECOVERY_REQUEST_MAX_CHARS,
  AGENT_MAX_PARALLEL_TOOL_CALLS,
  AGENT_MAX_ITERATIONS
} from './constants'
import { validateToolInput } from './utils'

export const AGENT_PLAN_TOOL_NAME = 'update_plan'
export const AGENT_CLARIFICATION_TOOL_NAME = 'request_clarification'
export const AGENT_SKILL_TOOL_NAME = 'load_agent_skill'
export const AGENT_TOOLKIT_LOADER_NAME = 'load_toolkit'

const AGENT_TOOL_NAME_SEPARATOR = '__'
const AGENT_RECOVERY_SUMMARY_ITEM_LIMIT = 3
const AGENT_RECOVERY_SUMMARY_MAX_CHARS = 240

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
- Load the most specific relevant toolkit before acting. Prefer a dedicated toolkit over a general operating-system toolkit when both could perform the task.
- When the owner provides a source to understand, prefer direct-source tools over secondary search. Use search as fallback when the source cannot be accessed or does not contain the needed evidence.
- Use the exact observed values from earlier tool results when chaining calls.
- Do not repeat an identical call when its result is already in the transcript.
- Use update_plan only when a visible plan materially helps a multi-step task. It is optional.
- If you create a plan, update its statuses as work advances and complete its final statuses before answering.
- If an Agent Skill is relevant, load it before executing the specialized workflow and follow its instructions.
- Context and memory tools provide external knowledge. They are not substitutes for the agent transcript.
</tool_policy>

<safety>
- Verify required paths, identifiers, accepted values, and prerequisites before side effects.
- Do not invent current, exact, mutable, environment-specific, or tool-produced facts.
- Stop and explain a genuine blocker rather than fabricating a result.
</safety>

<response_policy>
- Keep the final answer proportionate and concise by default.
- Use plain text rather than Markdown syntax.
- Refer to yourself in the first person.
- Wrap every file path as [FILE_PATH]/path[/FILE_PATH].
</response_policy>`

export const AGENT_LIMIT_FINALIZATION_SYSTEM_PROMPT = `<execution_limit_checkpoint>
The operational iteration budget is exhausted. Address the original owner request now using the evidence already present in the transcript.

- No operational tools are available in this checkpoint.
- If the evidence is sufficient, return the complete user-facing answer as plain text with no tool call.
- Do not claim completion when required evidence or work is still missing.
- If the request cannot yet be fully satisfied, call request_clarification. Include a concise explanation of what remains incomplete and why, any practical alternatives that exist, and one question asking whether the owner wants you to continue with a focused next pass.
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
  isFinalizationAttempt?: boolean
  isContextRecoveryAttempt?: boolean
  remainingIterations?: number
}

interface AgentFunctionExecutionResult {
  execution: ExecutionRecord
  handoffSignal?: FinalResponseSignal
}

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
    toolInput: string
  ) => Promise<AgentFunctionExecutionResult>
  loadAgentSkill: (skillId: string) => Promise<AgentSkillContext | null>
  loadToolkitContext?: (toolkitId: string) => string
  onAgentSkillLoaded?: (context: AgentSkillContext) => void
  onPlanUpdated?: (steps: TrackedPlanStep[]) => void
  initialExecutionHistory?: ExecutionRecord[]
  initialTrackedSteps?: TrackedPlanStep[]
  allowDirectAnswerHandoff?: boolean
  maxIterations?: number
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
          parameters: functionConfig.parameters
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
  let hasUsedOutputRecovery = false
  let hasUsedContextRecovery = false

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let modelResult: AgentModelResult | null
    let isRecoveryAttempt = false
    // Once a provider needs the smaller context target, keep that target for
    // the rest of the run instead of allowing the prompt to grow back.
    let isContextRecoveryAttempt = hasUsedContextRecovery
    const remainingIterations = maxIterations - iteration

    while (true) {
      try {
        modelResult = await params.callModel(
          transcript,
          params.catalog.tools,
          {
            isRecoveryAttempt,
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

      // One deterministic recovery keeps transient context exhaustion from
      // becoming a second agent mechanism or an unbounded retry loop.
      hasUsedOutputRecovery = true
      isRecoveryAttempt = true
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
          'I could not complete the request because the model exhausted its output budget after context recovery.',
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
        content: toolResult.content
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
    transcript,
    executionHistory,
    trackedSteps,
    false
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

  // A minimal evidence-only retry avoids exposing orchestration language when
  // the full transcript cannot produce a usable checkpoint response.
  const recoveryOutcome = await attemptAgentLimitFinalization(
    params,
    buildAgentLimitRecoveryTranscript(
      transcript,
      executionHistory,
      trackedSteps
    ),
    executionHistory,
    trackedSteps,
    true
  )
  if (recoveryOutcome) {
    transcript.push(...recoveryOutcome.messages)
    return {
      answer: recoveryOutcome.answer,
      intent: recoveryOutcome.intent,
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
  intent: 'answer' | 'clarification'
  messages: AgentToolTranscriptMessage[]
}

async function attemptAgentLimitFinalization(
  params: AgentLoopParams,
  modelTranscript: AgentToolTranscriptMessage[],
  executionHistory: ExecutionRecord[],
  trackedSteps: TrackedPlanStep[],
  isRecoveryAttempt: boolean
): Promise<AgentLimitFinalizationOutcome | null> {
  let modelResult: AgentModelResult | null
  try {
    modelResult = await params.callModel(
      modelTranscript,
      [createClarificationTool()],
      {
        isRecoveryAttempt,
        isFinalizationAttempt: true,
        ...(isRecoveryAttempt ? { isContextRecoveryAttempt: true } : {})
      }
    )
  } catch {
    return null
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

  if (
    toolCalls.some(
      (toolCall) => toolCall.function.name !== AGENT_CLARIFICATION_TOOL_NAME
    )
  ) {
    return null
  }

  const messages: AgentToolTranscriptMessage[] = [
    { role: 'assistant', content: textContent, toolCalls }
  ]
  let clarificationSignal: FinalResponseSignal | undefined
  for (const toolCall of toolCalls) {
    const toolResult = await executeAgentToolCall(
      toolCall,
      params,
      executionHistory,
      trackedSteps
    )
    messages.push({
      role: 'tool',
      toolCallId: toolCall.id,
      toolName: toolCall.function.name,
      content: toolResult.content
    })
    if (toolResult.signal?.intent === 'clarification') {
      clarificationSignal = toolResult.signal
    }
  }

  return clarificationSignal
    ? {
        answer: clarificationSignal.draft,
        intent: 'clarification',
        messages
      }
    : null
}

function buildAgentLimitRecoveryTranscript(
  transcript: AgentToolTranscriptMessage[],
  executionHistory: ExecutionRecord[],
  trackedSteps: TrackedPlanStep[]
): AgentToolTranscriptMessage[] {
  const originalRequest = findOriginalAgentRequest(transcript)
  const evidenceLines: string[] = []
  const seenEvidence = new Set<string>()
  let evidenceChars = 0

  for (const execution of executionHistory) {
    const observation = clipAgentLimitText(
      execution.observation,
      AGENT_LIMIT_RECOVERY_OBSERVATION_MAX_CHARS
    )
    const evidenceKey = [
      execution.function,
      execution.status,
      observation
    ].join('\n')
    if (seenEvidence.has(evidenceKey)) {
      continue
    }

    const line = `- ${execution.function} (${execution.status}): ${observation}`
    if (
      evidenceChars + line.length >
      AGENT_LIMIT_RECOVERY_EVIDENCE_MAX_CHARS
    ) {
      break
    }

    seenEvidence.add(evidenceKey)
    evidenceLines.push(line)
    evidenceChars += line.length
  }

  const planLines = trackedSteps.map(
    (step) => `- ${step.label}: ${step.status}`
  )
  return [
    {
      role: 'user',
      content: [
        '<original_owner_request>',
        clipAgentLimitText(
          originalRequest,
          AGENT_LIMIT_RECOVERY_REQUEST_MAX_CHARS
        ),
        '</original_owner_request>',
        '',
        '<verified_execution_evidence>',
        evidenceLines.length > 0
          ? evidenceLines.join('\n')
          : 'No completed tool evidence is available.',
        '</verified_execution_evidence>',
        '',
        '<plan_state>',
        planLines.length > 0 ? planLines.join('\n') : 'No explicit plan.',
        '</plan_state>'
      ].join('\n')
    }
  ]
}

function findOriginalAgentRequest(
  transcript: AgentToolTranscriptMessage[]
): string {
  const firstToolCallIndex = transcript.findIndex(
    (message) => message.role === 'assistant' && Boolean(message.toolCalls?.length)
  )
  const requestMessages = transcript
    .slice(0, firstToolCallIndex === -1 ? transcript.length : firstToolCallIndex)
    .filter(
      (message): message is Extract<AgentToolTranscriptMessage, { role: 'user' }> =>
        message.role === 'user'
    )
  const content = requestMessages.at(-1)?.content || 'Complete the owner request.'

  return extractAgentTaggedContent(content, 'user_request') || content
}

function extractAgentTaggedContent(content: string, tagName: string): string {
  const openingTag = `<${tagName}>`
  const closingTag = `</${tagName}>`
  const startIndex = content.indexOf(openingTag)
  if (startIndex === -1) {
    return ''
  }

  const valueStartIndex = startIndex + openingTag.length
  const endIndex = content.indexOf(closingTag, valueStartIndex)
  return endIndex === -1
    ? ''
    : content.slice(valueStartIndex, endIndex).trim()
}

function clipAgentLimitText(value: string, maxChars: number): string {
  const normalized = value.trim()
  return normalized.length <= maxChars
    ? normalized
    : `${normalized.slice(0, Math.max(maxChars - 3, 0)).trimEnd()}...`
}

function createResumableAgentResult(
  failureKind: 'context' | 'synthesis',
  transcript: AgentToolTranscriptMessage[],
  executionHistory: ExecutionRecord[],
  trackedSteps: TrackedPlanStep[]
): AgentLoopResult {
  const answer = buildResumableAgentAnswer(
    failureKind,
    transcript,
    executionHistory,
    trackedSteps
  )
  return {
    answer,
    intent: 'clarification',
    transcript,
    executionHistory,
    trackedSteps
  }
}

function buildResumableAgentAnswer(
  failureKind: 'context' | 'synthesis',
  transcript: AgentToolTranscriptMessage[],
  executionHistory: ExecutionRecord[],
  trackedSteps: TrackedPlanStep[]
): string {
  const ownerRequest = clipAgentLimitText(
    findOriginalAgentRequest(transcript),
    AGENT_RECOVERY_SUMMARY_MAX_CHARS
  )
  const verifiedItems = collectExecutionSummaries(
    executionHistory.filter((execution) => execution.status === 'success')
  )
  const unresolvedSteps = trackedSteps
    .filter((step) => step.status !== 'completed')
    .slice(0, AGENT_RECOVERY_SUMMARY_ITEM_LIMIT)
    .map((step) => `- ${step.label} (${step.status})`)
  const failedItems = collectExecutionSummaries(
    executionHistory.filter((execution) => execution.status !== 'success')
  )
  const remainingItems = unresolvedSteps.length > 0
    ? unresolvedSteps
    : failedItems
  const nextAction =
    trackedSteps.find((step) => step.status !== 'completed')?.label ||
    executionHistory
      .findLast((execution) => execution.status !== 'success')
      ?.stepLabel ||
    'Produce the final answer from the verified findings without repeating completed work'
  const failureExplanation =
    failureKind === 'context'
      ? 'The collected material could not be processed in one reliable pass.'
      : 'The final synthesis did not produce a usable answer.'

  return [
    `I have not yet produced a reliable answer to: "${ownerRequest}"`,
    failureExplanation,
    ...(verifiedItems.length > 0
      ? ['', 'Already verified:', ...verifiedItems]
      : []),
    '',
    'Still unresolved:',
    ...(remainingItems.length > 0
      ? remainingItems
      : ['- Turn the verified findings into the final answer.']),
    '',
    `Next, I will: ${nextAction}.`,
    'May I continue with that next step?'
  ].join('\n')
}

function collectExecutionSummaries(
  executions: ExecutionRecord[]
): string[] {
  const summaries: string[] = []
  const seenSummaries = new Set<string>()

  for (const execution of executions) {
    const observation = clipAgentLimitText(
      execution.observation.replace(/\s+/g, ' '),
      AGENT_RECOVERY_SUMMARY_MAX_CHARS
    )
    const summary = `- ${execution.stepLabel || execution.function}: ${observation}`
    if (seenSummaries.has(summary)) {
      continue
    }

    summaries.push(summary)
    seenSummaries.add(summary)
    if (summaries.length >= AGENT_RECOVERY_SUMMARY_ITEM_LIMIT) {
      break
    }
  }

  return summaries
}

async function executeAgentToolCall(
  toolCall: OpenAIToolCall,
  params: AgentLoopParams,
  executionHistory: ExecutionRecord[],
  trackedSteps: TrackedPlanStep[]
): Promise<{
  content: string
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

  const validation = validateToolInput(
    toolCall.function.arguments,
    callable.functionConfig.parameters
  )
  if (!validation.isValid) {
    return {
      content: `Tool input rejected for ${callable.qualifiedName}: ${validation.message || 'arguments do not match the schema'}`,
      trackedSteps
    }
  }

  const validatedInput =
    validation.repairedToolInput ?? toolCall.function.arguments
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
  let handoffSignal: FinalResponseSignal | undefined
  try {
    const result = await params.executeFunction(callable, validatedInput)
    execution = result.execution
    handoffSignal = result.handoffSignal
  } catch (error) {
    // Tool failures stay inside the protocol so the model can recover using
    // the same transcript instead of aborting the whole agent turn.
    execution = {
      function: callable.qualifiedName,
      status: 'error',
      observation: `Tool execution failed: ${String(error)}`,
      stepLabel: callable.qualifiedName,
      requestedToolInput: validatedInput
    }
  }

  executionHistory.push(execution)
  const shouldHandoff =
    handoffSignal?.intent !== 'answer' || params.allowDirectAnswerHandoff

  return {
    content: execution.observation,
    trackedSteps,
    ...(handoffSignal && shouldHandoff ? { signal: handoffSignal } : {})
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
