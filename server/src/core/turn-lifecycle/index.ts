import type { AgentProgressMessage } from '@/core/llm-manager/agent-progress-contract'
import type { AgentResponseTrace } from '@/types'
import { CONVERSATION_REPOSITORY } from '@/core/session-manager/conversation-repository'
import { LogHelper } from '@/helpers/log-helper'
import { randomUUID } from 'node:crypto'
import { generateFyi } from '@/core/fyi'
import { isFyiEligible, type Fyi } from '@/core/fyi/fyi-contract'

import type { LLMDutyResult } from '@/core/llm-manager/llm-duty'
import { POST_TURN_MAINTENANCE_QUEUE } from '@/core'
import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'
import { getTurnTimingContext, runWithTurnTiming, TurnStage } from '@/core/llm-manager/turn-timing'
import { schedulePostTurn } from './post-turn'

interface AgentTurnContext {
  sessionId: string
  query: string
  responseId?: string
  onActivity?: (activity: AgentProgressMessage) => void
  onFyi?: (fyi: Fyi, messageId: string) => void
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
    const trace = result?.data?.['agentResponseTrace'] as AgentResponseTrace | undefined
    const responseId = context.responseId ?? trace?.id ?? (context.turnId ? `${context.turnId}:leon` : undefined)
    const answer: unknown = result?.output
    if (responseId && typeof answer === 'string' && isFyiEligible(answer)) {
      POST_TURN_MAINTENANCE_QUEUE.startConcurrent('FYI generation', async () => {
        const record = CONVERSATION_REPOSITORY.readMessage(context.sessionId, responseId)
        if (!record?.isAddedToHistory || record.fyi || record.message !== answer) {
          return { outcome: 'skipped', reason: 'answer-unavailable-or-already-enriched' }
        }

        let candidate: Fyi | null = null
        try {
          candidate = await generateFyi(context.query, answer)
        } catch {
          // A footer failure must not reopen or invalidate an accepted answer.
          LogHelper.warning('FYI generation unavailable; using a queued mindset.')
        }
        const fyi = CONVERSATION_REPOSITORY.saveFyi(context.sessionId, responseId, answer, candidate)
        if (fyi) {
          context.onFyi?.(fyi, record.messageId ?? responseId)
        }
        return { outcome: fyi ? 'completed' : 'skipped' }
      }, TurnStage.PostTurn)
    }
    schedulePostTurn({ ...context, result, onActivity: (activity) => {
      if (!responseId) {
        return
      }
      try {
        if (CONVERSATION_REPOSITORY.upsertMemoryActivity(context.sessionId, responseId, activity)) {
          context.onActivity?.(activity)
        }
      } catch {
        LogHelper.warning('Could not publish a completed memory activity.')
      }
    } })

    return result
  })

  if (getTurnTimingContext()) {
    return execute()
  }

  return runWithTurnTiming(context.turnId ?? randomUUID(), context.sessionId, execute)
}
