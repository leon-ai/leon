import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

import { QUICK_EVAL_RUN_ID, QUICK_EVAL_SCHEMA } from './evaluation-report.js'

const measure = Type.Number({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
export const metrics = Type.Object({
  inputTokens: measure, outputTokens: measure, cachedInputTokens: measure,
  uncachedInputTokens: measure, peakInputTokens: measure, modelCalls: measure,
  failedCalls: measure, foregroundInputTokens: measure, maintenanceInputTokens: measure,
  turnLatencyMs: measure
})
export const evaluationStatus = Type.Union([Type.Literal('Passed'), Type.Literal('Warning'), Type.Literal('Failed')])
export const evaluationSource = Type.Union([Type.Literal('development'), Type.Literal('release')])
export const suiteRevision = Type.String({ pattern: '^[a-f0-9]{64}$' })
export const timestamp = Type.Integer({ minimum: 1, maximum: 8_640_000_000_000_000 })

const evaluationIndex = Type.Object({
  schemaVersion: Type.Literal(QUICK_EVAL_SCHEMA),
  runs: Type.Array(Type.Object({
    id: Type.String({ minLength: 1, maxLength: 100 }),
    sha: Type.String({ pattern: '^[a-f0-9]{40}$' }),
    recordedAt: timestamp,
    committedAt: Type.Optional(timestamp),
    durationMs: measure,
    version: Type.String({ minLength: 1, maxLength: 80 }),
    model: Type.String({ minLength: 1, maxLength: 256 }),
    reasoning: Type.String({ minLength: 1, maxLength: 80 }),
    suiteRevision,
    source: evaluationSource,
    runId: Type.String({ pattern: QUICK_EVAL_RUN_ID.source }),
    attempt: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    cases: Type.Array(Type.Object({
      scenario: Type.String({ minLength: 1, maxLength: 256 }), status: evaluationStatus,
      baseline: Type.Union([metrics, Type.Null()]), measured: Type.Union([metrics, Type.Null()]),
      samples: Type.Integer({ minimum: 0, maximum: 100 })
    }), { minItems: 1, maxItems: 100 })
  }))
})

export type EvaluationIndex = Static<typeof evaluationIndex>

/**
 * Validates the public index before storing it in the shared cache.
 */
export function isEvaluationIndex(value: unknown): value is EvaluationIndex {
  return Value.Check(evaluationIndex, value)
}
