import { randomUUID } from 'node:crypto'

import type { LLMDutyResult } from '@/core/llm-manager/llm-duty'
import { POST_TURN_MAINTENANCE_QUEUE } from '@/core'
import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'
import { getTurnTimingContext, runWithTurnTiming, TurnStage } from '@/core/llm-manager/turn-timing'
import { schedulePostTurn } from './post-turn'

interface AgentTurnContext {
  sessionId: string
  query: string
  turnId?: string
}

/**
 * Owns auxiliary work for every owner-agent entry point: titles start alongside
 * execution and post-turn maintenance follows delivery, without blocking either.
 */
export async function runTurnLifecycle(
  context: AgentTurnContext,
  executeAndDeliver: () => Promise<LLMDutyResult | null>
): Promise<LLMDutyResult | null> {
  const execute = (): Promise<LLMDutyResult | null> => CONVERSATION_SESSION_MANAGER.runWithSession(context.sessionId, async () => {
    const session = CONVERSATION_SESSION_MANAGER.getSession(context.sessionId)
    if (session && !session.isTitleGenerated && session.messageCount <= 1) {
      POST_TURN_MAINTENANCE_QUEUE.startConcurrent('session title generation', () =>
        CONVERSATION_SESSION_MANAGER.generateTitleFromFirstMessage(context.sessionId, context.query), TurnStage.PreTurn
      )
    }
    const result = await executeAndDeliver()
    schedulePostTurn({ ...context, result })

    return result
  })

  if (getTurnTimingContext()) {
    return execute()
  }

  return runWithTurnTiming(context.turnId ?? randomUUID(), context.sessionId, execute)
}
