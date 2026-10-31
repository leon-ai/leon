import { MEMORY_MANAGER, SELF_MODEL_MANAGER, POST_TURN_MAINTENANCE_QUEUE } from '@/core'
import { syncOwnerProfileFromTurn } from '@/core/context-manager/owner-profile-sync'
import type { LLMDutyResult } from '@/core/llm-manager/llm-duty'
import type { FinalPhaseIntent } from '@/core/llm-manager/llm-duties/react-llm-duty/agent-types'
import { normalizeOwnerProfileToolExecutions } from './turn-result'
import type { PostTurnMaintenanceTaskPreparer } from '@/core/post-turn-maintenance-queue'

export interface CompletedAgentTurn {
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
export function schedulePostTurn({ query, result }: CompletedAgentTurn): void {
  const output = result?.output as unknown
  if (typeof output !== 'string' || !output.trim()) {
    return
  }

  const sentAt = Date.now()
  const toolExecutions = normalizeOwnerProfileToolExecutions(result)
  const finalIntent = result?.data?.['finalIntent'] as FinalPhaseIntent | undefined

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
    POST_TURN_MAINTENANCE_QUEUE.enqueue('memory extraction', async () => {
      const savedCount = await MEMORY_MANAGER.saveMemoryCandidatesFromTurn(query, output, sentAt)
      if (savedCount > 0) {
        POST_TURN_MAINTENANCE_QUEUE.enqueue('owner profile sync', () =>
          syncOwnerProfileFromTurn(query, output, toolExecutions)
        )
      }
    })
  }
}
