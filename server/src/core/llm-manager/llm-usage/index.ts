import { randomUUID } from 'node:crypto'

import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { getActiveConversationSessionId } from '@/core/session-manager/session-context'
import { LogHelper } from '@/helpers/log-helper'
import { getActivePulseStage, measurePulse } from '@/core/telemetry/pulse-measurements'
import { inferenceUsageStorage, type InferenceUsageContext } from './usage-context'
import { appendInferenceUsage } from './usage-ledger'
import { getTurnTimingContext, recordForegroundInferenceUsage, recordTurnInferenceUsage } from '../../turn-lifecycle/observability/timing'

/**
 * Isolates each attempt's route and counters across parallel work and retries.
 * Accounting failures must never prevent Leon from returning a model response.
 */
export async function trackInferenceUsage<T>(
  target: { provider: string, model: string, purpose: string },
  execute: () => Promise<T>
): Promise<T> {
  const profileName = getActiveProfileName()
  const sessionId = getActiveConversationSessionId()
  const startedAt = Date.now()
  const turn = getTurnTimingContext()
  const id = randomUUID()
  const context: InferenceUsageContext = { usage: {}, outcome: 'failed' }

  return inferenceUsageStorage.run(context, async () => {
    try {
      return await execute()
    } finally {
      context.closed = true
      if (context.attemptId) {
        recordTurnInferenceUsage(context.attemptId, id, context.usage)
      }

      const usage = {
        provider: context.inference?.provider ?? target.provider,
        model: context.inference?.model ?? target.model,
        outcome: context.outcome,
        usage: { ...context.usage }
      }
      recordForegroundInferenceUsage(usage)
      const pulseStage = getActivePulseStage()
      if (pulseStage) {
        measurePulse({ stage: pulseStage, usage }, profileName)
      }

      try {
        await appendInferenceUsage(profileName, {
          id,
          startedAt,
          finishedAt: context.finishedAt ?? Date.now(),
          sessionId,
          ...turn,
          ...(context.attemptId ? { attemptId: context.attemptId } : {}),
          ...target,
          ...(context.inference ? { inference: context.inference } : {}),
          ...usage
        })
      } catch (error) {
        LogHelper.warning(`Could not save inference usage: ${String(error)}`)
      }
    }
  })
}
