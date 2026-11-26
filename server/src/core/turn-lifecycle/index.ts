import type { AgentProgressMessage } from '@/core/llm-manager/agent-progress-contract'
import type { AgentResponseTrace } from '@/types'
import { CONVERSATION_REPOSITORY } from '@/core/session-manager/conversation-repository'
import { LogHelper } from '@/helpers/log-helper'
import { randomUUID } from 'node:crypto'
import { generateFyi } from '@/core/fyi'
import { isFyiEligible, type Fyi } from '@/core/fyi/fyi-contract'

import type { LLMDutyResult } from '@/core/llm-manager/llm-duty'
import { LLM_PROVIDER, POST_TURN_MAINTENANCE_QUEUE } from '@/core'
import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'
import {
  getTurnTimingContext, recordOwnerTurn, recordOwnerTurnError, runWithTurnTiming, TurnPhase, TurnStage
} from '@/core/turn-lifecycle/observability/timing'
import { schedulePostTurn } from './post-turn'

interface AgentTurnContext {
  sessionId: string
  query: string
  responseId?: string
  onActivity?: (activity: AgentProgressMessage) => void
  onFyi?: (fyi: Fyi, messageId: string) => void
  turnId?: string
  signal?: AbortSignal
}

/**
 * Covers an accepted owner turn from preparation through response publishing.
 */
export async function runWithOwnerTurnTiming<T>(
  turnId: string, sessionId: string | null, execute: () => Promise<T>, signal?: AbortSignal
): Promise<T> {
  return runWithTurnTiming(turnId, sessionId, async () => {
    try {
      return await execute()
    } catch (error) {
      recordOwnerTurnError(error, signal)
      throw error
    }
  })
}

/**
 * Owns auxiliary work for every owner-agent entry point. The provider coordinates
 * foreground priority while post-turn maintenance follows answer delivery.
 */
export async function runTurnLifecycle(
  context: AgentTurnContext,
  executeAndDeliver: () => Promise<LLMDutyResult | null>
): Promise<LLMDutyResult | null> {
  const execute = (): Promise<LLMDutyResult | null> =>
    CONVERSATION_SESSION_MANAGER.runWithSession(context.sessionId, () =>
      LLM_PROVIDER.runForegroundTurn(async () => {
        const session = CONVERSATION_SESSION_MANAGER.getSession(context.sessionId)
        if (session && !session.isTitleGenerated && session.messageCount <= 1) {
          POST_TURN_MAINTENANCE_QUEUE.startConcurrent('session title generation', () =>
            CONVERSATION_SESSION_MANAGER.generateTitleFromFirstMessage(context.sessionId, context.query), TurnStage.PreTurn
          )
        }
        const result = await executeAndDeliver()
        const intent = result?.data?.['finalIntent']
        const metrics = result?.data?.['llmMetrics']
        const output = result?.output as unknown
        const hasOutput = typeof output === 'string' ? output.trim().length > 0 : Boolean(output)

        if (intent === 'cancelled' || (!hasOutput && context.signal?.aborted)) {
          recordOwnerTurn('canceled', metrics)
        } else if (intent === 'blocked') {
          recordOwnerTurn('blocked', metrics, undefined, { phase: TurnPhase.Execution, code: 'blocked' })
        } else if (intent === 'error') {
          recordOwnerTurn('failed', metrics, 'unknown', { phase: TurnPhase.Execution, code: 'error_response' })
        } else if (!hasOutput) {
          recordOwnerTurn('failed', metrics, 'no_output', { phase: TurnPhase.Execution, code: 'no_output' })
        } else {
          recordOwnerTurn(intent === 'clarification' ? 'clarification' : 'answered', metrics)
        }
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
            let usedFallback = false
            try {
              candidate = await generateFyi(context.query, answer)
            } catch {
              // A footer failure must not reopen or invalidate an accepted answer.
              LogHelper.warning('FYI generation unavailable; using a queued mindset.')
              usedFallback = true
            }
            const fyi = CONVERSATION_REPOSITORY.saveFyi(context.sessionId, responseId, answer, candidate)
            if (fyi) {
              context.onFyi?.(fyi, record.messageId ?? responseId)
            }
            if (usedFallback) {
              return { outcome: 'completed', reason: 'fyi-fallback' }
            }
            return { outcome: fyi ? 'completed' : 'skipped' }
          }, TurnStage.PostTurn)
        }
        schedulePostTurn({ ...context, ...(responseId ? { responseId } : {}), result, onActivity: (activity) => {
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
    )

  if (getTurnTimingContext()) {
    try {
      return await execute()
    } catch (error) {
      recordOwnerTurnError(error, context.signal)
      throw error
    }
  }

  return runWithOwnerTurnTiming(context.turnId ?? randomUUID(), context.sessionId, execute, context.signal)
}
