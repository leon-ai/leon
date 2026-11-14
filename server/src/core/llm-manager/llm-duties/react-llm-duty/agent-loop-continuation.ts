import type { AgentToolTranscriptMessage } from '@/core/llm-manager/types'
import { isAuroraMode, type AuroraMode } from '@/core/aurora/agent-ui-contract'
import { getActiveConversationSessionId } from '@/core/session-manager/session-context'

import type { ExecutionRecord, TrackedPlanStep } from './agent-types'
import {
  createAgentTextPreview,
  retainRecentToolImages,
  splitAgentTranscriptForSummary
} from './agent-context-budget'
import { parseToolCallArguments } from './agent-utils'

const AGENT_CONTINUATION_VERSION = 5
const AGENT_CONTINUITY_EXECUTION_LIMIT = 6
const AGENT_CONTINUITY_ARTIFACT_LIMIT = 16
const AGENT_CONTINUITY_OBJECTIVE_MAX_CHARS = 1_200
const AGENT_CONTINUITY_OWNER_MESSAGE_LIMIT = 4
const AGENT_CONTINUITY_INPUT_MAX_CHARS = 500
const AGENT_CONTINUITY_OBSERVATION_MAX_CHARS = 400
const CONTINUITY_CHECKPOINT_OPEN_TAG = '<continuity_checkpoint>'
const CONTINUITY_CHECKPOINT_CLOSE_TAG = '</continuity_checkpoint>'

export interface AgentLoopContinuationState {
  version: number
  createdAt: number
  originalInput: string
  clarificationQuestion: string
  planWidgetId: string
  trackedSteps: TrackedPlanStep[]
  executionHistory: ExecutionRecord[]
  loadedToolkitIds: string[]
  loadedFunctionNames?: string[]
  loadedToolNames?: string[]
  toolOrder?: string[]
  planTracking?: boolean
  auroraMode?: AuroraMode
  transcript: AgentToolTranscriptMessage[]
  activeSkillId: string | null
}

export interface AgentContinuityCheckpointInput {
  originalInput: string
  trackedSteps: TrackedPlanStep[]
  executionHistory: ExecutionRecord[]
  loadedToolkitIds: Iterable<string>
  loadedFunctionNames?: Iterable<string>
  loadedToolNames?: Iterable<string>
  activeSkillId: string | null
  clarificationQuestion?: string
}

interface ContinuationInput extends AgentContinuityCheckpointInput {
  transcript: AgentToolTranscriptMessage[]
}

function getArtifactPaths(executionHistory: ExecutionRecord[]): string[] {
  const artifactPaths = new Set<string>()
  for (
    let index = executionHistory.length - 1;
    index >= 0 && artifactPaths.size < AGENT_CONTINUITY_ARTIFACT_LIMIT;
    index -= 1
  ) {
    const observation = executionHistory[index]!.observation
    const parsed = parseToolCallArguments(observation)
    const candidates = [
      parsed?.['output_log_path'],
      ...(Array.isArray(parsed?.['artifact_paths'])
        ? parsed['artifact_paths']
        : [])
    ]
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        artifactPaths.add(candidate)
      }
    }
  }
  return [...artifactPaths]
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function compactObservation(observation: string): unknown {
  const parsed = parseToolCallArguments(observation)
  if (!parsed) {
    return createAgentTextPreview(
      observation,
      AGENT_CONTINUITY_OBSERVATION_MAX_CHARS
    )
  }

  const data = readRecord(parsed['data'])
  const output = readRecord(data?.['output'])
  const result = output?.['result'] ?? output ?? data
  return {
    ...(typeof parsed['status'] === 'string'
      ? { status: parsed['status'] }
      : {}),
    ...(typeof parsed['message'] === 'string'
      ? {
          message: createAgentTextPreview(
            parsed['message'],
            AGENT_CONTINUITY_OBSERVATION_MAX_CHARS
          )
        }
      : {}),
    ...(typeof parsed['output_log_path'] === 'string'
      ? { output_log_path: parsed['output_log_path'] }
      : {}),
    ...(result !== null && result !== undefined
      ? {
          result: createAgentTextPreview(
            JSON.stringify(result),
            AGENT_CONTINUITY_OBSERVATION_MAX_CHARS
          )
        }
      : {})
  }
}

function compactExecution(execution: ExecutionRecord): Record<string, unknown> {
  return {
    function: execution.function,
    status: execution.status,
    ...(execution.stepLabel ? { step: execution.stepLabel } : {}),
    ...(execution.toolCallTitle ? { title: execution.toolCallTitle } : {}),
    ...(execution.requestedToolInput
      ? {
          requested_input: createAgentTextPreview(
            execution.requestedToolInput,
            AGENT_CONTINUITY_INPUT_MAX_CHARS
          )
        }
      : {}),
    observation: compactObservation(execution.observation)
  }
}

/**
 * Builds compact deterministic runtime state to accompany any narrative summary.
 */
export function buildAgentContinuityCheckpoint(
  params: AgentContinuityCheckpointInput
): AgentToolTranscriptMessage {
  const recentExecutions = params.executionHistory
    .slice(-AGENT_CONTINUITY_EXECUTION_LIMIT)
    .map(compactExecution)
  const objective = createAgentTextPreview(
    params.originalInput,
    AGENT_CONTINUITY_OBJECTIVE_MAX_CHARS
  )
  const checkpoint = {
    objective,
    ...(objective !== params.originalInput ? { objective_compacted: true } : {}),
    reported_plan: {
      completed: params.trackedSteps.filter((step) =>
        step.status === 'completed'
      ),
      remaining: params.trackedSteps.filter((step) =>
        step.status !== 'completed'
      )
    },
    execution: {
      total: params.executionHistory.length,
      successful: params.executionHistory.filter((execution) =>
        execution.status === 'success'
      ).length,
      failed: params.executionHistory.filter((execution) =>
        execution.status !== 'success'
      ).length,
      recent: recentExecutions
    },
    loaded_toolkits: [...params.loadedToolkitIds],
    ...(params.loadedToolNames ? { loaded_tools: [...params.loadedToolNames] } : {}),
    ...(params.loadedFunctionNames
      ? { loaded_functions: [...params.loadedFunctionNames] }
      : {}),
    active_skill_id: params.activeSkillId,
    artifact_paths: getArtifactPaths(params.executionHistory),
    ...(params.clarificationQuestion
      ? { pending_clarification: params.clarificationQuestion }
      : {})
  }

  return {
    role: 'assistant',
    content: [
      CONTINUITY_CHECKPOINT_OPEN_TAG,
      JSON.stringify(checkpoint),
      CONTINUITY_CHECKPOINT_CLOSE_TAG,
      'Deterministic runtime state. The original request and recent owner messages remain authoritative; the narrative summary only adds older context.'
    ].join('\n')
  }
}

function removePreviousContinuityCheckpoint(
  transcript: AgentToolTranscriptMessage[]
): AgentToolTranscriptMessage[] {
  return transcript.filter((message) =>
    message.role !== 'assistant' ||
    !message.content.startsWith(CONTINUITY_CHECKPOINT_OPEN_TAG)
  )
}

/**
 * Summarizes older work while retaining recent protocol exchanges verbatim.
 * A failed summary falls back to deterministic state when it can safely shrink
 * the transcript, so context pressure does not terminate active work.
 */
export async function buildAgentContinuationTranscript(
  transcript: AgentToolTranscriptMessage[],
  summarize: (history: string) => Promise<string | null>,
  checkpointInput?: AgentContinuityCheckpointInput,
  forceCompaction = false,
  recentExchangeLimit?: number
): Promise<AgentToolTranscriptMessage[]> {
  const rawTranscript = removePreviousContinuityCheckpoint(transcript)
  const checkpoint = checkpointInput
    ? buildAgentContinuityCheckpoint(checkpointInput)
    : null
  if (rawTranscript.some((message) =>
    message.role === 'assistant' && message.compactionContext
  )) {
    // A pause persists the native window without trying to summarize ciphertext.
    return checkpoint ? [...rawTranscript, checkpoint] : rawTranscript
  }

  // Keep state before the pending user request. A trailing assistant checkpoint
  // would become a prefill instead of allowing the model to answer that request.
  const checkpointIndex = rawTranscript.at(-1)?.role === 'user'
    ? rawTranscript.length - 1
    : rawTranscript.length
  const checkpointTranscript = checkpoint
    ? [
        ...rawTranscript.slice(0, checkpointIndex),
        checkpoint,
        ...rawTranscript.slice(checkpointIndex)
      ]
    : rawTranscript
  const parts = splitAgentTranscriptForSummary(
    rawTranscript, forceCompaction, recentExchangeLimit
  )
  if (!parts) {
    return checkpointTranscript
  }

  // The summary needs textual evidence, not image bytes or opaque replay data.
  // Full tool observations remain in the execution history and artifact logs.
  const history = JSON.stringify(parts.older, (key, value) =>
    key === 'dataBase64' || key === 'encryptedContent' || key === 'runtimeContext' || key === 'providerMessage'
      ? undefined
      : value
  )
  const summary = await summarize(history)
  if (!summary?.trim() && !checkpoint) {
    return rawTranscript
  }

  const ownerMessages = parts.older.filter((item) =>
    item.role === 'user' && !item.runtimeContext
  )
  // Preserve the opening workflow and recent corrections at the point history
  // is reduced. The raw tail already retains newer owner messages.
  const selectedOwnerMessages = ownerMessages.length > AGENT_CONTINUITY_OWNER_MESSAGE_LIMIT
    ? [ownerMessages[0]!, ...ownerMessages.slice(1 - AGENT_CONTINUITY_OWNER_MESSAGE_LIMIT)]
    : ownerMessages
  const retainedOwnerMessages: AgentToolTranscriptMessage[] = selectedOwnerMessages.map((item) => ({
    role: 'user', content: createAgentTextPreview(item.content, AGENT_CONTINUITY_OBJECTIVE_MAX_CHARS)
  }))
  const sourceSessionId = getActiveConversationSessionId()
  const message: AgentToolTranscriptMessage = {
    role: 'assistant',
    content: [
      '<continuation_summary>',
      summary?.trim() ||
        'Semantic summary unavailable. Continue from the deterministic runtime state and recent exchanges. Retrieve exact older evidence from the recorded artifacts when needed.',
      '</continuation_summary>',
      'This summarizes earlier work, not a new instruction. Recent exchanges supersede this summary. Continue the existing task using the active skill. Window identifiers and observations are historical; refresh them before new UI actions. Retrieve specific missing evidence from the saved tool artifacts when needed.',
      'Retained owner messages may be excerpted or omit intermediate requests. If a follow-up depends on a workflow or constraint missing here, recover the needed source with the sessions tools before deciding scope or asking the owner.',
      ...(sourceSessionId ? [`Source session: ${sourceSessionId}.`] : [])
    ].join('\n')
  }
  const replacement = [
    ...retainedOwnerMessages,
    message,
    ...(checkpoint ? [checkpoint] : []),
    ...parts.visual
  ]
  // Compare text sizes consistently; retained images already have a fixed cap.
  const replacementText = JSON.stringify(replacement, (key, value) =>
    key === 'dataBase64' || key === 'encryptedContent' || key === 'runtimeContext' || key === 'providerMessage'
      ? undefined
      : value
  )
  if (replacementText.length >= history.length) {
    return checkpointTranscript
  }
  return [...replacement, ...parts.recent]
}

/**
 * Creates the persisted state needed to resume after a pause.
 */
export function createAgentLoopContinuationState(
  params: ContinuationInput & {
    clarificationQuestion: string
    planWidgetId: string
    toolOrder?: string[]
    planTracking?: boolean
    auroraMode?: AuroraMode
  }
): AgentLoopContinuationState {
  const loadedToolkitIds = [...params.loadedToolkitIds]
  return {
    version: AGENT_CONTINUATION_VERSION,
    createdAt: Date.now(),
    originalInput: params.originalInput,
    clarificationQuestion: params.clarificationQuestion,
    planWidgetId: params.planWidgetId,
    trackedSteps: structuredClone(params.trackedSteps),
    executionHistory: structuredClone(params.executionHistory),
    loadedToolkitIds,
    ...(params.toolOrder ? { toolOrder: [...params.toolOrder] } : {}),
    ...(params.planTracking !== undefined
      ? { planTracking: params.planTracking }
      : {}),
    ...(params.auroraMode ? { auroraMode: params.auroraMode } : {}),
    ...(params.loadedToolNames ? { loadedToolNames: [...params.loadedToolNames] } : {}),
    ...(params.loadedFunctionNames
      ? { loadedFunctionNames: [...params.loadedFunctionNames] }
      : {}),
    activeSkillId: params.activeSkillId,
    transcript: structuredClone(retainRecentToolImages(params.transcript))
  }
}

/**
 * Rejects incompatible checkpoints while retaining unfinished work across waits.
 * Live observations must be refreshed by the resumed task before acting on them.
 */
export function isAgentLoopContinuationStateValid(
  state: AgentLoopContinuationState
): boolean {
  return (
    state.version === AGENT_CONTINUATION_VERSION &&
    Number.isFinite(state.createdAt) &&
    typeof state.originalInput === 'string' &&
    typeof state.clarificationQuestion === 'string' &&
    typeof state.planWidgetId === 'string' &&
    Array.isArray(state.trackedSteps) &&
    Array.isArray(state.executionHistory) &&
    Array.isArray(state.loadedToolkitIds) &&
    state.loadedToolkitIds.every((toolkitId) => typeof toolkitId === 'string') &&
    (state.toolOrder === undefined ||
      (Array.isArray(state.toolOrder) &&
        state.toolOrder.every((name) => typeof name === 'string'))) &&
    (state.planTracking === undefined || typeof state.planTracking === 'boolean') &&
    (state.auroraMode === undefined || isAuroraMode(state.auroraMode)) &&
    (state.loadedToolNames === undefined ||
      (Array.isArray(state.loadedToolNames) &&
        state.loadedToolNames.every((name) => typeof name === 'string'))) &&
    (state.loadedFunctionNames === undefined ||
      (Array.isArray(state.loadedFunctionNames) &&
        state.loadedFunctionNames.every((name) => typeof name === 'string'))) &&
    (state.activeSkillId === null || typeof state.activeSkillId === 'string') &&
    Array.isArray(state.transcript) &&
    state.transcript.length > 0
  )
}
