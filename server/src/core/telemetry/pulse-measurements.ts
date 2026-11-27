import { AsyncLocalStorage } from 'node:async_hooks'

import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import type { InferenceUsage } from '@/core/llm-manager/llm-usage/usage-context'
import { getPublicModel, getPulseFailureCounter, OTHER_MODEL, OTHER_PROVIDER, PULSE_TIMING_BUCKETS_MS, TELEMETRY_MAX_PULSE_BUCKETS,
  type PublicModelLabel, type PulseCounter, type PulseFailure, type PulseReport, type PulseStage, type PulseTimingMetric } from './report-contract'

type PulseBatch = Pick<PulseReport, 'counters' | 'failures' | 'usage' | 'timings'>
interface PulseUsage { provider: string, model: string, outcome: string, usage: InferenceUsage }
type Measurement = { counter: PulseCounter, count: number } | { stage: PulseStage, usage: PulseUsage } |
  { failure: Omit<PulseFailure, 'count'> } |
  { metric: PulseTimingMetric, ms: number, pulseActive: boolean, provider?: string, model?: string }

const stages = new AsyncLocalStorage<{ stage: PulseStage, onModel?: (label: PublicModelLabel) => void }>()
const batches = new Map<string, PulseBatch>()
const MICROS_PER_DOLLAR = 1_000_000
let shouldMeasure: ((profile: string) => boolean) | undefined

/**
 * Enables in-memory counters only for profiles sharing telemetry.
 */
export function startPulseMeasurements(enabled: (profile: string) => boolean): () => void {
  shouldMeasure = enabled
  return () => {
    shouldMeasure = undefined
    batches.clear()
  }
}

/**
 * Moves accumulated measurements to the background delivery queue.
 */
export function takePulseMeasurements(profile: string): PulseBatch | undefined {
  const batch = batches.get(profile)
  batches.delete(profile)
  return batch
}

/**
 * Attributes existing calls to their Pulse stage and makes their public label available to failure reporting.
 */
export function withPulseStage<T>(stage: PulseStage, execute: () => T, onModel?: (label: PublicModelLabel) => void): T {
  return shouldMeasure ? stages.run({ stage, ...(onModel ? { onModel } : {}) }, execute) : execute()
}

/**
 * Returns whether an existing inference belongs to Pulse.
 */
export function getActivePulseStage(): PulseStage | undefined {
  return stages.getStore()?.stage
}

/**
 * Collects content-free Pulse measurements without affecting inference or delivery.
 */
export function measurePulse(measurement: Measurement, profile?: string): void {
  if (!shouldMeasure) {
    return
  }

  try {
    const name = profile ?? getActiveProfileName()
    if (!shouldMeasure(name)) {
      batches.delete(name)
      return
    }
    const batch = batches.get(name) ?? { counters: {}, usage: [], timings: [] }
    if ('counter' in measurement) {
      batch.counters[measurement.counter] = (batch.counters[measurement.counter] ?? 0) + measurement.count
    } else if ('failure' in measurement) {
      const { code, scope, inference, causeCode } = measurement.failure
      const counter = getPulseFailureCounter(scope)
      batch.counters[counter] = (batch.counters[counter] ?? 0) + 1

      const failures = batch.failures ??= []
      const existing = failures.find((row) => row.code === code && row.scope === scope && row.causeCode === causeCode &&
        row.inference?.provider === inference?.provider && row.inference?.model === inference?.model &&
        row.inference?.quantization === inference?.quantization)
      if (existing) {
        existing.count++
      } else if (failures.length < TELEMETRY_MAX_PULSE_BUCKETS) {
        // Keep one local log reference per group even when a batch contains repeated failures.
        failures.push({ ...measurement.failure, count: 1 })
      }
    } else if ('stage' in measurement) {
      const { stage, usage: entry } = measurement
      const label = getPublicModel(entry.provider, entry.model)
      stages.getStore()?.onModel?.(label)
      const usage = batch.usage.find((row) => row.stage === stage && row.provider === label.provider &&
        row.model === label.model && row.quantization === label.quantization)
      if (!usage && batch.usage.length >= TELEMETRY_MAX_PULSE_BUCKETS) {
        return
      }
      const bucket = usage ?? { ...label, stage, calls: 0, failedCalls: 0, inputTokens: 0, outputTokens: 0,
        cachedInputTokens: 0, cacheReportedCalls: 0, costMicros: 0, costSamples: 0 }
      if (!usage) {
        batch.usage.push(bucket)
      }
      const { inputTokens, outputTokens, cachedInputTokens, costUSD } = entry.usage
      bucket.calls++
      bucket.failedCalls += Number(entry.outcome !== 'completed')
      bucket.inputTokens += inputTokens ?? 0
      bucket.outputTokens += outputTokens ?? 0
      bucket.cachedInputTokens += Math.min(inputTokens ?? 0, cachedInputTokens ?? 0)
      bucket.cacheReportedCalls += Number(cachedInputTokens !== undefined)
      if (costUSD !== undefined) {
        bucket.costMicros += Math.round(costUSD * MICROS_PER_DOLLAR)
        bucket.costSamples++
      }
    } else {
      const { metric, pulseActive, ms } = measurement
      const { provider, model } = getPublicModel(measurement.provider ?? OTHER_PROVIDER, measurement.model ?? OTHER_MODEL)
      const timing = batch.timings.find((row) => row.metric === metric && row.provider === provider &&
        row.model === model && row.pulseActive === pulseActive)
      if (!timing && batch.timings.length >= TELEMETRY_MAX_PULSE_BUCKETS) {
        return
      }
      const bucket = timing ?? { metric, pulseActive, provider, model, buckets: Array<number>(PULSE_TIMING_BUCKETS_MS.length + 1).fill(0) }
      if (!timing) {
        batch.timings.push(bucket)
      }
      const index = PULSE_TIMING_BUCKETS_MS.findIndex((maximum) => ms <= maximum)
      bucket.buckets[index < 0 ? PULSE_TIMING_BUCKETS_MS.length : index]!++
    }
    batches.set(name, batch)
  } catch {
    // Telemetry never owns a Pulse decision or an owner turn.
  }
}
