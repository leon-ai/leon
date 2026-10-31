import { randomUUID } from 'node:crypto'

import type { LLMDutyResult } from '@/core/llm-manager/llm-duty'
import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'
import { getTurnTimingContext, runWithTurnTiming } from '@/core/llm-manager/turn-timing'
import { schedulePostTurn } from './post-turn'

interface AgentTurnContext {
  sessionId: string
  query: string
  turnId?: string
}

/**
 * Makes post-turn work part of every owner-agent entry point's completion contract.
 * The callback owns foreground execution and delivery; maintenance never delays it.
 */
export async function runTurnLifecycle(
  context: AgentTurnContext,
  executeAndDeliver: () => Promise<LLMDutyResult | null>
): Promise<LLMDutyResult | null> {
  const execute = (): Promise<LLMDutyResult | null> => CONVERSATION_SESSION_MANAGER.runWithSession(context.sessionId, async () => {
    const result = await executeAndDeliver()
    schedulePostTurn({ ...context, result })

    return result
  })

  if (getTurnTimingContext()) {
    return execute()
  }

  return runWithTurnTiming(context.turnId ?? randomUUID(), context.sessionId, execute)
}
