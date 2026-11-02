import assert from 'node:assert/strict'

import type { RealScenarioTurn } from '../../../e2e/run-agent-provider-scenario'
import type { ScenarioContext } from '../../scenario-fixture'
import type { LLMDutyResult } from '@/core/llm-manager/llm-duty'

/**
 * Hold an occupied maintenance worker while real owner turns build a backlog.
 * Only scheduling is controlled; foreground and learning use the active model.
 */
export async function withLearningBacklog(
  context: ScenarioContext,
  workspace: string,
  execute: (run: (query: string) => Promise<RealScenarioTurn>) => Promise<void>
): Promise<Record<string, unknown>> {
  const { POST_TURN_MAINTENANCE_QUEUE } = await import('@/core')
  const { CONVERSATION_SESSION_MANAGER } = await import('@/core/session-manager')
  const { runTurnLifecycle } = await import('@/core/turn-lifecycle')
  const { runWithConversationSession } = await import('@/core/session-manager/session-context')
  const { readInferenceUsage } = await import('@/core/llm-manager/llm-usage/usage-ledger')
  const { InferencePurpose } = await import('@/core/llm-manager/types')
  const { TurnStage } = await import('@/core/llm-manager/turn-timing')
  const sessionId = CONVERSATION_SESSION_MANAGER.createSession().id
  const gate = Promise.withResolvers<void>()
  const turns: RealScenarioTurn[] = []
  await POST_TURN_MAINTENANCE_QUEUE.whenIdle()

  try {
    await runWithConversationSession({ sessionId }, async () => {
      POST_TURN_MAINTENANCE_QUEUE.enqueue('scenario occupied maintenance worker', () => gate.promise)
      await execute(async (query) => {
        let turn!: RealScenarioTurn
        await runTurnLifecycle({ sessionId, query }, async () => {
          turn = await context.runTurn(query, sessionId)
          assert.equal(turn.finalIntent, 'answer', turn.output)
          return { output: turn.output, data: {
            finalIntent: turn.finalIntent, executionHistory: turn.executionHistory,
            hasExplicitMemoryWrite: turn.hasExplicitMemoryWrite, workspace
          } } as unknown as LLMDutyResult
        })
        turns.push(turn)
        return turn
      })
    })
  } finally {
    gate.resolve()
    await POST_TURN_MAINTENANCE_QUEUE.whenIdle()
  }

  const extraction = []
  for await (const usage of readInferenceUsage({ sessionId, stage: TurnStage.PostTurn })) {
    if (usage.purpose === InferencePurpose.Memory) {
      extraction.push(usage)
    }
  }
  const eligibleTurns = turns.filter((turn) => !turn.hasExplicitMemoryWrite).length
  assert.equal(extraction.length, Math.ceil(eligibleTurns / 3), 'Only bounded extraction batches should call the model.')
  return { sessionId, turns, eligibleTurns, extraction }
}
