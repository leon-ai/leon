import type { ContextUsageMetrics } from '../llm-manager/llm-usage/context-usage'
import type { OwnerTurnOutcome } from '../turn-lifecycle/observability/timing-contract'

export const INSIGHTS_RANGES = [7, 14, 30, 90, 180, 365] as const
export const INSIGHTS_INTERVALS = ['day', 'week', 'month'] as const
export type InsightsInterval = typeof INSIGHTS_INTERVALS[number]

export const PULSE_INSIGHTS_RETENTION_DAYS = 30

export enum PulseTickOutcome {
  Idle = 'idle',
  Skipped = 'skipped',
  Quiet = 'quiet',
  Duplicate = 'duplicate',
  Saved = 'saved',
  Shared = 'shared',
  Failed = 'failed',
  Unknown = 'unknown'
}

export type PulseTickTrigger = 'scheduled' | 'follow_up' | 'manual'

export interface PulseTickEvent {
  at: number
  phase: 'tick' | 'agenda' | 'evidence' | 'planning' | 'research' | 'review' | 'storage' | 'delivery'
  code: string
  detail: string
  diagnosticId?: string
  toolCalls?: number
  tools?: { name: string, status: string }[]
}

export interface PulseTick {
  id: string
  startedAt: number
  durationMs: number | null
  trigger: PulseTickTrigger | null
  outcome: PulseTickOutcome
  investigated: boolean
  matter: string | null
  events: PulseTickEvent[]
  recovered?: true
}

export interface PulseInsights {
  enabled: boolean
  page: number
  pages: number
  total: number
  investigated: number
  outcomes: Partial<Record<PulseTickOutcome, number>>
  ticks: PulseTick[]
  nextFollowUp: { matter: string, question: string, checkAt: number, expiresAt: number } | null
}

export interface UsageTotals {
  modelCalls: number
  failedModelCalls: number
  meteredCalls: number
  tokenReportedCalls: number
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  cacheReportedCalls: number
  cacheComparableInputTokens: number
  cacheComparableCachedTokens: number
  cacheComparableCalls: number
}

export interface ModelUsage extends UsageTotals {
  provider: string
  model: string
}

export interface UsageSummary extends UsageTotals {
  turns: number
  finishedTurns: number
  failedTurns: number
  blockedTurns: number
  canceledTurns: number
  clarificationTurns: number
  tokenMeasuredTurns: number
  measuredTurnTokens: number
  fullyMeasuredTurns: number
  fullyMeasuredTokens: number
  medianTurnTokens: number | null
  p95TurnTokens: number | null
  medianContextPercent: number | null
  p95ContextPercent: number | null
  medianAnswerMs: number | null
  p95AnswerMs: number | null
  toolCalls: number
  durationMs: number
  toolDurationMs: number
  modelDurationMs: number
  firstOutputMs: number
  firstOutputCount: number
  contextPercent: number
  contextCount: number
}

export interface UsageTurnView extends UsageTotals {
  startedAt: number
  durationMs: number
  outcome: OwnerTurnOutcome
  toolCalls: number
  toolDurationMs: number
  modelDurationMs: number
  firstOutputMs?: number
  context?: ContextUsageMetrics
  version?: string
  provider: string | null
  model: string | null
}

export interface InsightsUsage {
  firstOwnerMessageAt: number | null
  unreadableRecords: number
  current: UsageSummary
  previous: UsageSummary
  series: (UsageSummary & { day: number, previous: UsageSummary })[]
  models: ModelUsage[]
  contextPage: number
  contextPages: number
  contextModels: Pick<ModelUsage, 'provider' | 'model'>[]
  recentTurns: UsageTurnView[]
  repeatedQueries: { message: string, occurrences: number, turns: UsageTurnView[] }[]
}

export interface TelemetrySetting {
  enabled: boolean
}

export const EVALUATION_STATUSES = ['Passed', 'Warning', 'Failed'] as const
export const EVALUATION_SOURCES = ['development', 'release', 'local'] as const
export const EVALUATION_UNKNOWN_SUITE = 'unrecorded'
export type EvaluationStatus = typeof EVALUATION_STATUSES[number]
export type EvaluationSource = Exclude<typeof EVALUATION_SOURCES[number], 'local'>

export interface EvaluationMetrics {
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  uncachedInputTokens: number
  peakInputTokens: number
  modelCalls: number
  failedCalls: number
  foregroundInputTokens: number
  maintenanceInputTokens: number
  turnLatencyMs: number
}

export interface EvaluationRun {
  id: string
  recordedAt: number
  committedAt?: number
  sha: string
  model: string
  reasoning: string
  version?: string
  suiteRevision?: string
  source?: EvaluationSource
  runId?: string
  runUrl?: string
  attempt?: number
  durationMs?: number
  cases: {
    scenario: string
    status: EvaluationStatus
    baseline: EvaluationMetrics | null
    measured: EvaluationMetrics | null
    samples: number
  }[]
}

export interface EvaluationQuery {
  source?: typeof EVALUATION_SOURCES[number] | undefined
  model?: string | undefined
  reasoning?: string | undefined
  suite?: string | undefined
  scenario?: string | undefined
  days?: number | undefined
  page?: number | undefined
}

export interface EvaluationHistoryView {
  models: string[]
  reasons: string[]
  suites: string[]
  scenarios: string[]
  model: string
  reasoning: string
  suite: string
  scenario: string
  page: number
  pages: number
  refreshFailed: boolean
  points: {
    id: string
    sha: string
    date: number
    model: string
    reasoning: string
    suite: string
    baseline: EvaluationMetrics | null
    measured: EvaluationMetrics | null
    outcomes: Record<EvaluationStatus, number>
  }[]
  rows: (Pick<EvaluationRun,
    'id' | 'sha' | 'recordedAt' | 'committedAt' | 'source' | 'version' | 'runId' | 'runUrl' | 'suiteRevision'
  > & {
    outcomes: Record<EvaluationStatus, number>
    samples: number
  })[]
}
