import type { AgentToolTranscriptMessage } from '@/core/llm-manager/types'

import type { ExecutionRecord, TrackedPlanStep } from './types'
import {
  AGENT_LIMIT_RECOVERY_EVIDENCE_MAX_CHARS,
  AGENT_LIMIT_RECOVERY_OBSERVATION_MAX_CHARS,
  AGENT_LIMIT_RECOVERY_REQUEST_MAX_CHARS
} from './constants'

const AGENT_CONTINUATION_VERSION = 3
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
}

/** Creates the persisted transcript needed to resume after clarification. */
export function createAgentLoopContinuationState(params: {
  originalInput: string
  clarificationQuestion: string
  planWidgetId: string
  trackedSteps: TrackedPlanStep[]
  executionHistory: ExecutionRecord[]
  loadedToolkitIds: Iterable<string>
}): AgentLoopContinuationState {
  const loadedToolkitIds = [...params.loadedToolkitIds]

  return {
    version: AGENT_CONTINUATION_VERSION,
    createdAt: Date.now(),
    originalInput: params.originalInput,
    clarificationQuestion: params.clarificationQuestion,
    planWidgetId: params.planWidgetId,
    trackedSteps: params.trackedSteps.map((step) => ({ ...step })),
    executionHistory: params.executionHistory.map((execution) => ({
      ...execution
    })),
    loadedToolkitIds,
    transcript: buildContinuationTranscript({
      originalInput: params.originalInput,
      trackedSteps: params.trackedSteps,
      executionHistory: params.executionHistory,
      loadedToolkitIds
    })
  }
}

function buildContinuationTranscript(params: {
  originalInput: string
  trackedSteps: TrackedPlanStep[]
  executionHistory: ExecutionRecord[]
  loadedToolkitIds: string[]
}): AgentToolTranscriptMessage[] {
  const request = clipText(
    params.originalInput,
    AGENT_LIMIT_RECOVERY_REQUEST_MAX_CHARS
  )
  const evidence = collectRecentEvidence(params.executionHistory)
  const pendingSteps = params.trackedSteps
    .filter((step) => step.status !== 'completed')
    .map((step) => `- ${step.label} (${step.status})`)
  const checkpoint = [
    '<continuation_checkpoint>',
    'Original owner request:',
    request,
    ...(evidence.length > 0
      ? ['', 'Saved execution evidence:', ...evidence]
      : []),
    ...(pendingSteps.length > 0
      ? ['', 'Remaining plan steps:', ...pendingSteps]
      : []),
    ...(params.loadedToolkitIds.length > 0
      ? [
          '',
          `Loaded toolkits: ${params.loadedToolkitIds.join(', ')}`
        ]
      : []),
    '',
    'Continue from this checkpoint without repeating completed work.',
    '</continuation_checkpoint>'
  ].join('\n')

  return [{ role: 'user', content: checkpoint }]
}

function collectRecentEvidence(
  executionHistory: ExecutionRecord[]
): string[] {
  const evidence: string[] = []
  let evidenceChars = 0

  for (let index = executionHistory.length - 1; index >= 0; index -= 1) {
    const execution = executionHistory[index]!
    const observation = clipText(
      execution.observation.replace(/\s+/g, ' '),
      AGENT_LIMIT_RECOVERY_OBSERVATION_MAX_CHARS
    )
    const line = `- ${execution.stepLabel || execution.function} [${execution.status}]: ${observation}`
    if (
      evidenceChars + line.length >
      AGENT_LIMIT_RECOVERY_EVIDENCE_MAX_CHARS
    ) {
      break
    }

    evidence.unshift(line)
    evidenceChars += line.length
  }

  return evidence
}

function clipText(value: string, maxChars: number): string {
  const normalized = value.trim()
  return normalized.length <= maxChars
    ? normalized
    : `${normalized.slice(0, Math.max(maxChars - 3, 0)).trimEnd()}...`
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
    Array.isArray(state.transcript) &&
    state.transcript.length > 0
  )
}
