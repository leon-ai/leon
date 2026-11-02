import { performance } from 'node:perf_hooks'
import type { AgentProgressMessage } from '@/core/llm-manager/agent-progress-contract'
import { createMemoryActivity } from '@/core/memory-manager/memory-activity'
import type { MemoryChange } from '@/core/llm-manager/memory-activity-contract'
import { MEMORY_MANAGER, SELF_MODEL_MANAGER, EXPERIENCE_MANAGER, POST_TURN_MAINTENANCE_QUEUE } from '@/core'
import type { ExecutionRecord, FinalPhaseIntent } from '@/core/llm-manager/llm-duties/react-llm-duty/agent-types'
import { hasExperienceLearningEvidence } from '@/core/experience-manager'
import { syncOwnerProfileFromTurn } from '@/core/context-manager/owner-profile-sync'
import type { LLMDutyResult } from '@/core/llm-manager/llm-duty'
import { normalizeOwnerProfileToolExecutions } from './turn-result'
import type { PostTurnMaintenanceTaskPreparer } from '@/core/post-turn-maintenance-queue'
import { MEMORY_EXTRACTION_MAX_BATCH_TURNS } from '@/constants'
import { getTurnTimingContext } from '@/core/llm-manager/turn-timing'

export interface CompletedAgentTurn {
  onActivity?: (activity: AgentProgressMessage) => void
  sessionId: string
  query: string
  result: LLMDutyResult | null
}

/**
 * Defers compaction eligibility and model work off the foreground execution stack.
 * Standalone agent duties retain the same maintenance contract as hosted turns.
 */
export function scheduleHistoryCompaction(prepare: PostTurnMaintenanceTaskPreparer): void {
  POST_TURN_MAINTENANCE_QUEUE.enqueueIfNeeded('agent history compaction', prepare)
}

/**
 * Schedules owner-turn maintenance after the answer has been persisted and delivered.
 * Explicit memory mutations must not be repeated by automatic extraction.
 */
export function schedulePostTurn({ sessionId, query, result, onActivity }: CompletedAgentTurn): void {
  const output = result?.output as unknown
  if (typeof output !== 'string' || !output.trim()) {
    return
  }

  const sentAt = Date.now()
  const toolExecutions = normalizeOwnerProfileToolExecutions(result)
  const finalIntent = result?.data?.['finalIntent'] as FinalPhaseIntent | undefined

  const executions = (result?.data?.['executionHistory'] ?? []) as ExecutionRecord[]
  if (finalIntent === 'answer' && hasExperienceLearningEvidence(executions)) {
    const workspace = typeof result?.data?.['workspace'] === 'string' ? result.data['workspace'] : process.cwd()
    POST_TURN_MAINTENANCE_QUEUE.enqueue('experience learning', () => EXPERIENCE_MANAGER.observeTurn({
      query, output, executions, workspace, ...(onActivity ? { onActivity } : {}), sourceRef: `session:${sessionId}:turn:${sentAt}`
    }))
  }

  POST_TURN_MAINTENANCE_QUEUE.enqueue('turn memory observation', () => MEMORY_MANAGER.observeTurn({
    userMessage: query,
    assistantMessage: output,
    sentAt,
    route: 'react',
    toolExecutions
  }))
  POST_TURN_MAINTENANCE_QUEUE.enqueue('react self-model reflection', () => SELF_MODEL_MANAGER.observeTurn({
    userMessage: query,
    assistantMessage: output,
    sentAt,
    route: 'react',
    finalIntent: finalIntent ?? 'answer',
    toolExecutions
  }))

  if (result?.data?.['hasExplicitMemoryWrite'] === true) {
    POST_TURN_MAINTENANCE_QUEUE.enqueue('owner profile sync', () =>
      syncOwnerProfileFromTurn(query, output, toolExecutions)
    )
  } else if (finalIntent !== 'cancelled' && finalIntent !== 'error') {
    const changes: MemoryChange[] = []
    POST_TURN_MAINTENANCE_QUEUE.enqueueBatch('memory extraction', {
      changes, onActivity, onMemoryChange: (change: MemoryChange) => changes.push(change),
      userMessage: query, assistantMessage: output, sentAt, toolExecutions,
      sourceRef: `session:${sessionId}:turn:${getTurnTimingContext()?.turnId ?? sentAt}`
    }, MEMORY_EXTRACTION_MAX_BATCH_TURNS, async (turns) => {
      const startedAt = Date.now()
      const extractionStartedAt = performance.now()
      const savedCounts = await MEMORY_MANAGER.saveMemoryCandidatesFromTurns(turns)
      const durationMs = performance.now() - extractionStartedAt
      for (const [index, turn] of turns.entries()) {
        const actions = new Set(turn.changes.map((change) => change.action))
        for (const action of actions) {
          turn.onActivity?.(createMemoryActivity(
            `${turn.sourceRef}:${action}`, action,
            turn.changes.filter((change) => change.action === action).map((change) => change.entry),
            startedAt, turns.length === 1 && actions.size === 1 ? durationMs : undefined
          ))
        }
        if ((savedCounts[index] ?? 0) > 0) {
          POST_TURN_MAINTENANCE_QUEUE.enqueue('owner profile sync', () =>
            syncOwnerProfileFromTurn(turn.userMessage, turn.assistantMessage, turn.toolExecutions)
          )
        }
      }
    })
  }
}
