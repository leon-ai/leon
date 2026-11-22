import path from 'node:path'

import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

import { getLLMModelCatalogEntries } from '../llm-manager/llm-model-catalog'
import { LOCAL_LLM_MODELS, LOCAL_LLM_PRECISIONS } from '../llm-manager/local-model-catalog'
import { LLMProviders } from '../llm-manager/types'
import { OWNER_TURN_FAILURE_CODES } from '../llm-manager/turn-timing-contract'

export const DAILY_REPORT_PATH = '/v1/daily'
export const PRESENCE_REPORT_PATH = '/v1/presence'
export const TELEMETRY_EVENT_PATH = '/v2/event'
export const TELEMETRY_EVENTS_HEADER = 'x-leon-telemetry-events'
export const TELEMETRY_EVENTS_VERSION = 2
export const TELEMETRY_SCHEMA_HEADER = 'x-leon-telemetry-version'
export const TELEMETRY_FLEET_HEADER = 'x-leon-telemetry-fleet'
export const TELEMETRY_ACTIVATION_HEADER = 'x-leon-telemetry-activation'
export const TELEMETRY_SCHEMA_VERSION = 1
export const TELEMETRY_DAY_MS = 86_400_000
export const TELEMETRY_RETRY_DAYS = 7
export const TELEMETRY_MINUTE_MS = 60_000
export const TELEMETRY_MAX_MODEL_BUCKETS = 100
export const TELEMETRY_MAX_CAPABILITY_BUCKETS = 64
export const OTHER_MODEL = 'other'
export const OTHER_PROVIDER = 'other'
export const PRESENCE_INTERVAL_MS = 5 * 60_000
export const LATENCY_BUCKETS_MS = [250, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 45_000, 90_000, 180_000] as const
export const INSTALLATION_MILESTONES = ['setup', 'first_query', 'ten_queries', 'first_answer', 'returning', 'day_7', 'day_30'] as const

const identifier = Type.String({ pattern: '^[a-f0-9]{64}$' })
const count = Type.Integer({ minimum: 0, maximum: 1_000_000_000_000 })
const total = Type.Number({ minimum: 0, maximum: 1_000_000_000_000 })
const utcDay = Type.Integer({ minimum: 0, maximum: 100_000 })
const histogram = Type.Array(count, { minItems: LATENCY_BUCKETS_MS.length + 1, maxItems: LATENCY_BUCKETS_MS.length + 1 })
const version = Type.String({ pattern: '^(?:(?:unknown|mixed)|\\d{1,5}\\.\\d{1,5}\\.\\d{1,5}(?:-(?:alpha|beta|rc)(?:\\.\\d{1,5}){0,3})?)$' })
const provider = Type.Enum(LLMProviders)
const modelProperties = {
  provider: Type.Union([provider, Type.Literal(OTHER_PROVIDER)]),
  model: Type.String({ maxLength: 128 }),
  quantization: Type.Optional(Type.Union(LOCAL_LLM_PRECISIONS.map(({ name }) => Type.Literal(name)))),
  calls: count,
  failedCalls: count,
  inputTokens: count,
  outputTokens: count,
  cachedInputTokens: count,
  cacheReportedCalls: count
}

export const dailyReportSchema = Type.Object({
  schemaVersion: Type.Literal(TELEMETRY_SCHEMA_VERSION),
  installation: identifier,
  profile: identifier,
  day: utcDay,
  version,
  firstReportingDay: Type.Boolean(),
  turns: count,
  answered: count,
  failed: count,
  canceled: count,
  clarifications: count,
  measuredTurns: count,
  measuredTurnTokens: count,
  toolCalls: count,
  toolDurationMs: count,
  modelDurationMs: count,
  durationMs: count,
  firstOutputMs: count,
  firstOutputCount: count,
  contextPercent: total,
  contextCount: count,
  models: Type.Array(Type.Object(modelProperties, { additionalProperties: false }), { maxItems: TELEMETRY_MAX_MODEL_BUCKETS }),
  fleet: Type.Optional(Type.Object({
    os: Type.Union([Type.Literal('linux'), Type.Literal('darwin'), Type.Literal('win32'), Type.Literal('other')]),
    architecture: Type.Union([Type.Literal('arm64'), Type.Literal('x64'), Type.Literal('other')]),
    buildCommit: Type.Optional(Type.String({ pattern: '^[a-f0-9]{40}$' })),
    timezoneOffset: Type.Optional(Type.Integer({ minimum: -12, maximum: 14 })),
    turnLatency: histogram,
    firstOutputLatency: histogram,
    recoveredTurns: count,
    failures: Type.Array(Type.Object({
      code: Type.Union(OWNER_TURN_FAILURE_CODES.map((code) => Type.Literal(code))),
      count
    }, { additionalProperties: false }), { maxItems: OWNER_TURN_FAILURE_CODES.length }),
    activation: Type.Optional(Type.Object({
      setupDay: Type.Optional(utcDay),
      firstAnswerMs: Type.Optional(Type.Integer({
        minimum: 0, maximum: (TELEMETRY_RETRY_DAYS + 2) * TELEMETRY_DAY_MS, multipleOf: TELEMETRY_MINUTE_MS
      }))
    }, { additionalProperties: false })),
    milestones: Type.Optional(Type.Array(Type.Object({
      name: Type.Union(INSTALLATION_MILESTONES.map((name) => Type.Literal(name))),
      day: utcDay,
      cohort: utcDay,
      newSetup: Type.Optional(Type.Boolean()),
      firstAnswerMs: Type.Optional(count)
    }, { additionalProperties: false }), { maxItems: INSTALLATION_MILESTONES.length }))
  }, { additionalProperties: false }))
}, { additionalProperties: false })

export type DailyReport = Static<typeof dailyReportSchema>
export type FleetReport = NonNullable<DailyReport['fleet']>
export type InstallationMilestone = NonNullable<FleetReport['milestones']>[number]
const timeZone = Type.String({ maxLength: 64 })
export const presenceReportSchema = Type.Object({
  installation: identifier, timeZone: Type.Optional(timeZone)
}, { additionalProperties: false })
export type PresenceReport = Static<typeof presenceReportSchema>
const capabilityName = Type.String({ minLength: 1, maxLength: 96, pattern: '^[a-zA-Z0-9_-]+$' })
const capabilityCounts = { calls: Type.Integer({ minimum: 1, maximum: 10_000 }), failed: count, durationMs: Type.Optional(count) }
const skillKinds = Type.Union([Type.Literal('agent_skill'), Type.Literal('native_skill')])
const unnamedSource = Type.Union([Type.Literal('extension'), Type.Literal('mcp'), Type.Literal('other')])
const capabilityUsage = Type.Union([
  Type.Object({
    kind: Type.Literal('tool'), source: Type.Literal('built_in'),
    toolkit: capabilityName, tool: capabilityName, function: capabilityName, ...capabilityCounts
  }, { additionalProperties: false }),
  Type.Object({
    kind: skillKinds, source: Type.Literal('built_in'), skill: capabilityName, ...capabilityCounts
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Union([Type.Literal('tool'), skillKinds]), source: unnamedSource, ...capabilityCounts
  }, { additionalProperties: false })
])
export type CapabilityUsage = Static<typeof capabilityUsage>
const telemetryEventSchema = Type.Object({
  id: identifier,
  kind: Type.Union([Type.Literal('profile_started'), Type.Literal('turn_finished'), Type.Literal('skill_finished')]),
  at: Type.Integer({ minimum: 0, maximum: 100_000 * TELEMETRY_DAY_MS }),
  timeZone,
  capabilities: Type.Optional(Type.Array(capabilityUsage, { maxItems: TELEMETRY_MAX_CAPABILITY_BUCKETS })),
  contextReduction: Type.Optional(Type.Object({ count, estimatedTokensReclaimed: count }, { additionalProperties: false })),
  report: dailyReportSchema
}, { additionalProperties: false })
export type TelemetryEventReport = Static<typeof telemetryEventSchema>

export const PULSE_COUNTERS = [
  'idle', 'active_conversation', 'cooldown', 'provider_unavailable', 'tick_failed',
  'discovery_checked', 'followup_checked', 'followup_on_time', 'followup_late',
  'discovery_silent', 'followup_silent', 'discovery_duplicate', 'followup_duplicate',
  'discovery_saved', 'followup_saved', 'discovery_delivered', 'followup_delivered',
  'discovery_failed', 'followup_failed', 'delivery_failed', 'tool_calls',
  'new_findings', 'accepted', 'declined', 'scheduled', 'expired', 'displaced', 'resolved_in_chat', 'resolved_before_check'
] as const
export type PulseCounter = (typeof PULSE_COUNTERS)[number]
export enum PulseStage {
  Planning = 'planning', Research = 'research', Review = 'review', Feedback = 'feedback', Resolution = 'resolution'
}
export enum PulseTimingMetric {
  FollowUpLateness = 'followup_lateness', Investigation = 'investigation',
  ForegroundQueue = 'foreground_queue', ForegroundOutput = 'foreground_output'
}
export const PULSE_TIMING_BUCKETS_MS = [50, 100, ...LATENCY_BUCKETS_MS, 300_000, 900_000, 1_800_000, 3_600_000, TELEMETRY_DAY_MS] as const
export const TELEMETRY_MAX_PULSE_BUCKETS = 48
const pulseReportSchema = Type.Object({
  kind: Type.Literal('pulse_metrics'), id: identifier, installation: identifier, profile: identifier, version,
  at: Type.Integer({ minimum: 0, maximum: 100_000 * TELEMETRY_DAY_MS }),
  counters: Type.Partial(Type.Object(Object.fromEntries(PULSE_COUNTERS.map((key) => [key, count])), { additionalProperties: false })),
  usage: Type.Array(Type.Object({ ...modelProperties, stage: Type.Enum(PulseStage), costMicros: count, costSamples: count },
    { additionalProperties: false }), { maxItems: TELEMETRY_MAX_PULSE_BUCKETS }),
  timings: Type.Array(Type.Object({
    metric: Type.Enum(PulseTimingMetric), pulseActive: Type.Boolean(), provider: modelProperties.provider, model: modelProperties.model,
    buckets: Type.Array(count, { minItems: PULSE_TIMING_BUCKETS_MS.length + 1, maxItems: PULSE_TIMING_BUCKETS_MS.length + 1 })
  }, { additionalProperties: false }), { maxItems: TELEMETRY_MAX_PULSE_BUCKETS })
}, { additionalProperties: false })
export type PulseReport = Static<typeof pulseReportSchema>

/**
 * Accepts only counts, fixed Pulse categories, and public model dimensions.
 */
export function isPulseReport(value: unknown): value is PulseReport {
  return Value.Check(pulseReportSchema, value) && value.usage.every((row) =>
    isPublicModelLabel(row) && row.calls > 0 && row.failedCalls <= row.calls && row.costSamples <= row.calls &&
    row.cacheReportedCalls <= row.calls && row.cachedInputTokens <= row.inputTokens) &&
    value.timings.every((row) => isPublicModelLabel(row) && row.buckets.some((count) => count > 0))
}

/**
 * Resolves IANA names and aliases while excluding numeric offsets and locale abbreviations.
 */
export function getIanaTimeZone(value: string): string | undefined {
  if (value !== 'UTC' && !value.includes('/')) {
    return undefined
  }
  try {
    return Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

/**
 * Checks the shape and timezone of an event sent by Core.
 */
export function isTelemetryEventReport(value: unknown): value is TelemetryEventReport {
  return Value.Check(telemetryEventSchema, value) && getIanaTimeZone(value.timeZone) !== undefined
}

/**
 * Checks that a daily report contains only the fields in Leon's telemetry contract.
 */
export function isDailyReport(report: unknown): report is DailyReport {
  return Value.Check(dailyReportSchema, report)
}

/**
 * Checks the installation-only presence payload.
 */
export function isPresenceReport(report: unknown): report is PresenceReport {
  return Value.Check(presenceReportSchema, report) &&
    (report.timeZone === undefined || getIanaTimeZone(report.timeZone) !== undefined)
}

const knownModels = new Map<string, Set<string>>(
  Object.values(LLMProviders).map((value) => [
    value, new Set(getLLMModelCatalogEntries(value).map((entry) => entry.model))
  ])
)
type PublicModelLabel = Pick<DailyReport['models'][number], 'provider' | 'model' | 'quantization'>

const localPublicNames = new Map<string, string>(LOCAL_LLM_MODELS.flatMap(({ id, name }) => [
  [id, name], [name, name]
]))
const localGGUFLabels = new Map<string, Pick<PublicModelLabel, 'model' | 'quantization'>>(
  LOCAL_LLM_MODELS.flatMap(({ name, filePrefix }) => LOCAL_LLM_PRECISIONS.map(({ name: quantization }) => [
    `${filePrefix}-${quantization}.gguf`.toLowerCase(), { model: name, quantization }
  ]))
)
const MANAGED_GGUF_CHECKSUM = /-[a-f0-9]{64}(?=\.gguf$)/i

/**
 * Only canonical catalog names leave Core. Private model aliases share one bucket.
 */
export function getPublicModel(provider: string, model: string): PublicModelLabel {
  if (provider === LLMProviders.LlamaCPP || provider === LLMProviders.SGLang) {
    const publicName = localPublicNames.get(model)
    if (publicName) {
      return { provider, model: publicName }
    }
    if (provider === LLMProviders.LlamaCPP) {
      // Windows and POSIX filenames both follow the managed catalog's naming convention.
      const filename = path.win32.basename(model).replace(MANAGED_GGUF_CHECKSUM, '').toLowerCase()
      const label = localGGUFLabels.get(filename)
      if (label) {
        return { provider, ...label }
      }
    }
  }

  const models = knownModels.get(provider)
  return {
    provider: models ? provider as LLMProviders : OTHER_PROVIDER,
    model: models?.has(model) ? model : OTHER_MODEL
  }
}

/**
 * Checks that a received label contains only public model metadata.
 */
export function isPublicModelLabel(label: PublicModelLabel): boolean {
  const canonical = getPublicModel(label.provider, label.model)
  return label.provider === canonical.provider && label.model === canonical.model &&
    (label.quantization === undefined ||
      (label.provider === LLMProviders.LlamaCPP && localPublicNames.has(label.model)))
}
