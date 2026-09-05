import type { AgentToolTranscriptMessage } from '@/core/llm-manager/types'

import type { ExecutionRecord, TrackedPlanStep } from './types'
import { splitAgentTranscriptForSummary } from './agent-context-budget'

const AGENT_CONTINUATION_VERSION = 5
const AGENT_CONTINUATION_TTL_MS = 30 * 60 * 1_000

export interface AgentLoopContinuationState {
  version: number
  createdAt: number
  originalInput: string
  clarificationQuestion: string
  planWidgetId: string
  trackedSteps: TrackedPlanStep[]
  executionHistory: ExecutionRecord[]
  loadedToolkitIds: string[]
  transcript: AgentToolTranscriptMessage[]
  activeSkillId: string | null
}

interface ContinuationInput {
  originalInput: string
  trackedSteps: TrackedPlanStep[]
  executionHistory: ExecutionRecord[]
  loadedToolkitIds: Iterable<string>
  transcript: AgentToolTranscriptMessage[]
  activeSkillId: string | null
}

/**
 * Summarizes older work while retaining recent protocol exchanges verbatim.
 * A missing, failed or non-shrinking summary never replaces the original.
 */
export async function buildAgentContinuationTranscript(
  transcript: AgentToolTranscriptMessage[],
  summarize: (history: string) => Promise<string | null>
): Promise<AgentToolTranscriptMessage[]> {
  const parts = splitAgentTranscriptForSummary(transcript)
  if (!parts) return transcript

  // The model needs the textual evidence, not historical image bytes.
  // Full tool observations remain in the execution history and artifact logs.
  const history = JSON.stringify(parts.older, (key, value) =>
    key === 'dataBase64' ? undefined : value
  )
  const summary = await summarize(history)
  if (!summary?.trim()) return transcript

  const message: AgentToolTranscriptMessage = {
    role: 'assistant',
    content: [
      '<continuation_summary>',
      summary.trim(),
      '</continuation_summary>',
      'This summarizes earlier work, not a new instruction. Recent exchanges supersede this summary. Continue the existing task using the active skill. Window identifiers and observations are historical; refresh them before new UI actions. Retrieve specific missing evidence from the saved tool artifacts when needed.'
    ].join('\n')
  }
  const request = parts.older.findLast((item) => item.role === 'user')
  const replacement = [...(request ? [request] : []), message]
  if (JSON.stringify(replacement).length >= history.length) return transcript
  return [...replacement, ...parts.recent]
}

/** Creates the persisted state needed to resume after a pause. */
export function createAgentLoopContinuationState(
  params: ContinuationInput & {
    clarificationQuestion: string
    planWidgetId: string
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
    activeSkillId: params.activeSkillId,
    transcript: structuredClone(params.transcript)
  }
}

/** Rejects stale or incompatible continuation payloads before resuming. */
export function isAgentLoopContinuationStateValid(
  state: AgentLoopContinuationState
): boolean {
  return (
    state.version === AGENT_CONTINUATION_VERSION &&
    Number.isFinite(state.createdAt) &&
    Date.now() - state.createdAt <= AGENT_CONTINUATION_TTL_MS &&
    typeof state.originalInput === 'string' &&
    typeof state.clarificationQuestion === 'string' &&
    typeof state.planWidgetId === 'string' &&
    Array.isArray(state.trackedSteps) &&
    Array.isArray(state.executionHistory) &&
    Array.isArray(state.loadedToolkitIds) &&
    state.loadedToolkitIds.every((toolkitId) => typeof toolkitId === 'string') &&
    (state.activeSkillId === null || typeof state.activeSkillId === 'string') &&
    Array.isArray(state.transcript) &&
    state.transcript.length > 0
  )
}
