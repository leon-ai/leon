import { AsyncLocalStorage } from 'node:async_hooks'

import type { InferenceMetadata } from '../inference-metadata'
import { readCompletionAccounting, type CompletionAccounting } from './usage-accounting'
import type { InferencePurpose } from '../types'

export interface InferenceUsage extends CompletionAccounting {
  inputTokens?: number
  outputTokens?: number
}

export interface InferenceUsageContext {
  inference?: InferenceMetadata
  usage: InferenceUsage
  outcome: string
  finishedAt?: number
  closed?: boolean
}

export const inferenceUsageStorage = new AsyncLocalStorage<InferenceUsageContext>()
const inferencePurposeStorage = new AsyncLocalStorage<InferencePurpose>()

/**
 * Labels nested agent requests with the background activity that initiated them.
 */
export function runWithInferencePurpose<T>(purpose: InferencePurpose, execute: () => T): T {
  return inferencePurposeStorage.run(purpose, execute)
}

/**
 * Returns the initiating activity without crossing asynchronous request boundaries.
 */
export function getActiveInferencePurpose(): InferencePurpose | undefined {
  return inferencePurposeStorage.getStore()
}

function tokenCount(...values: unknown[]): number | undefined {
  for (const value of values) {
    const count = value && typeof value === 'object'
      ? (value as Record<string, unknown>)['total']
      : value

    if (typeof count === 'number' && Number.isFinite(count) && count >= 0) {
      return count
    }
  }

  return undefined
}

/**
 * Attributes usage to the binding that actually dispatched this attempt.
 */
export function recordInferenceUsageMetadata(inference: InferenceMetadata): void {
  const context = inferenceUsageStorage.getStore()

  if (context && !context.closed) {
    context.inference = { ...inference }
  }
}

/**
 * Reads reported totals without treating SDK defaults as provider observations.
 * SDK Anthropic totals include cache reads/writes; its raw input count excludes them.
 */
export function readProviderUsage(value: unknown): InferenceUsage {
  if (!value || typeof value !== 'object') {
    return {}
  }

  const usage = value as Record<string, unknown>
  const raw = usage['raw'] && typeof usage['raw'] === 'object'
    ? usage['raw'] as Record<string, unknown>
    : usage
  let inputTokens = tokenCount(
    usage['inputTokens'], usage['promptTokens'],
    raw['input_tokens'], raw['prompt_tokens']
  )
  let outputTokens = tokenCount(
    usage['outputTokens'], usage['completionTokens'],
    raw['output_tokens'], raw['completion_tokens']
  )

  // Some SDK adapters synthesize zero totals when a response omits usage.
  if ('raw' in usage) {
    if (inputTokens === 0 && tokenCount(raw['input_tokens'], raw['prompt_tokens']) === undefined) {
      inputTokens = undefined
    }
    if (outputTokens === 0 && tokenCount(raw['output_tokens'], raw['completion_tokens']) === undefined) {
      outputTokens = undefined
    }
  }

  return {
    ...readCompletionAccounting(value),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {})
  }
}

/**
 * Retains the latest reported counters, including usage received before failure.
 * Stream counters are snapshots, so repeated events must not be added together.
 */
export function recordInferenceUsage(value: unknown): void {
  const context = inferenceUsageStorage.getStore()

  if (context && !context.closed) {
    context.usage = { ...context.usage, ...readProviderUsage(value) }
  }
}

/**
 * Keeps the attempt outcome independent of a later retry's result.
 */
export function recordInferenceUsageOutcome(outcome: string): void {
  const context = inferenceUsageStorage.getStore()

  if (context && !context.closed) {
    context.outcome = outcome
    context.finishedAt = Date.now()
  }
}
