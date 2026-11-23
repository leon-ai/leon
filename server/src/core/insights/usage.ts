import { readInferenceUsage, type InferenceUsageRecord } from '@/core/llm-manager/llm-usage/usage-ledger'
import { readContextUsage } from '@/core/llm-manager/llm-usage/context-usage'
import { readTurnHistory, TurnPhase, TurnStage, type CompletedOwnerTurn } from '@/core/llm-manager/turn-timing'
import { OWNER_TURN_FAILURE_CODES, type OwnerTurnFailureCode } from '@/core/llm-manager/turn-timing-contract'
import { getProfilePaths } from '@/core/profile-runtime/profile-paths'

import { CONVERSATION_REPOSITORY } from '@/core/session-manager/conversation-repository'

import type {
  InsightsInterval, UsageSummary, UsageTurnView, InsightsUsage, ModelUsage, UsageTotals
} from './insights-contract'

export const UTC_DAY_MS = 86_400_000
const RECENT_TURN_LIMIT = 30
const REPEAT_CANDIDATE_LIMIT = 2_000
const REPEAT_GROUP_LIMIT = 80
const REPEAT_TURN_LIMIT = 100
const REPEAT_MESSAGE_LIMIT = 280

interface ActivityTurn extends Omit<UsageTurnView, 'provider' | 'model'> {
  id: string
  sessionId: string | null
  models: Map<string, ModelUsage>
  primaryModel?: ModelUsage
  failure?: OwnerTurnFailureCode
}

function emptyUsage(): UsageTotals {
  return {
    modelCalls: 0, failedModelCalls: 0, meteredCalls: 0, tokenReportedCalls: 0,
    inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheReportedCalls: 0,
    cacheComparableInputTokens: 0, cacheComparableCachedTokens: 0, cacheComparableCalls: 0
  }
}

function addUsage(target: UsageTotals, source: UsageTotals): void {
  target.modelCalls += source.modelCalls
  target.failedModelCalls += source.failedModelCalls
  target.meteredCalls += source.meteredCalls
  target.tokenReportedCalls += source.tokenReportedCalls
  target.inputTokens += source.inputTokens
  target.outputTokens += source.outputTokens
  target.cachedInputTokens += source.cachedInputTokens
  target.cacheReportedCalls += source.cacheReportedCalls
  target.cacheComparableInputTokens += source.cacheComparableInputTokens
  target.cacheComparableCachedTokens += source.cacheComparableCachedTokens
  target.cacheComparableCalls += source.cacheComparableCalls
}

function measuredNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value
  }
  return undefined
}

function makeTurn(
  id: string, sessionId: unknown, startedAt: number, durationMs: number, outcome: ActivityTurn['outcome']
): ActivityTurn {
  return {
    ...emptyUsage(), id, sessionId: typeof sessionId === 'string' ? sessionId : null,
    startedAt, durationMs, outcome, models: new Map(),
    toolCalls: 0, modelDurationMs: 0, toolDurationMs: 0
  }
}

function addInference(turn: ActivityTurn, entry: Pick<InferenceUsageRecord, 'provider' | 'model' | 'outcome' | 'usage'>): void {
  const input = measuredNumber(entry.usage.inputTokens)
  const output = measuredNumber(entry.usage.outputTokens)
  const cached = measuredNumber(entry.usage.cachedInputTokens)
  const cacheComparable = input !== undefined && cached !== undefined && cached <= input && input > 0
  const usage: UsageTotals = {
    modelCalls: 1, failedModelCalls: Number(entry.outcome === 'failed'),
    meteredCalls: Number(input !== undefined && output !== undefined),
    tokenReportedCalls: Number(input !== undefined || output !== undefined),
    inputTokens: input ?? 0, outputTokens: output ?? 0,
    cachedInputTokens: cached ?? 0, cacheReportedCalls: Number(cached !== undefined),
    cacheComparableInputTokens: cacheComparable ? input : 0,
    cacheComparableCachedTokens: cacheComparable ? cached : 0,
    cacheComparableCalls: Number(cacheComparable)
  }
  const key = JSON.stringify([entry.provider, entry.model])
  const model = turn.models.get(key) ?? { ...emptyUsage(), provider: entry.provider, model: entry.model }
  addUsage(turn, usage)
  addUsage(model, usage)
  turn.models.set(key, model)
  if (!turn.primaryModel || model.modelCalls > turn.primaryModel.modelCalls) {
    turn.primaryModel = model
  }
}

/**
 * Uses finalized in-memory measurements so reporting never needs to reread the profile history.
 */
export function summarizeCompletedOwnerTurn(completed: CompletedOwnerTurn): ActivityTurn {
  const { id, startedAt, durationMs, measurement, timings } = completed
  const turn = makeTurn(id, null, startedAt, durationMs, measurement.outcome)
  turn.version = measurement.version
  if (measurement.context) {
    turn.context = measurement.context
  }
  if (measurement.failure) {
    turn.failure = measurement.failure
  }

  for (const timing of timings) {
    if (timing.stage !== TurnStage.AgentLoop) {
      continue
    }
    if (timing.kind === 'inference') {
      turn.modelDurationMs += timing.durationMs
      if (timing.firstOutputMs !== undefined) {
        const elapsed = Math.max(0, timing.startedAt + timing.firstOutputMs - startedAt)
        turn.firstOutputMs = Math.min(turn.firstOutputMs ?? elapsed, elapsed)
      }
    } else if (timing.goal === TurnPhase.Tool) {
      turn.toolCalls++
      turn.toolDurationMs += timing.durationMs
    }
  }
  for (const usage of completed.inferenceUsage) {
    addInference(turn, usage)
  }

  return turn
}

/**
 * Joins foreground timing and provider accounting within one profile. Historical
 * turns with an agent execution phase can be shown locally when outcome was inferred.
 */
export async function readUsageTurns(
  from: number, until: number, options: {
    profile?: string
    explicitOwnerOnly?: boolean
    onUnreadableRecord?: () => void
  } = {}
): Promise<ActivityTurn[]> {
  const paths = getProfilePaths(options.profile)
  interface TimingTotals {
    turn?: ActivityTurn
    execution: boolean
    explicit: boolean
    toolCalls: number
    toolDurationMs: number
    modelDurationMs: number
    firstOutputAt?: number
  }
  const rows = new Map<string, TimingTotals>()

  // Read the next date as well so a turn that starts before midnight keeps its calls.
  for await (const record of readTurnHistory({ from, until: until + UTC_DAY_MS }, paths, options.onUnreadableRecord)) {
    const id = record['turnId']
    if (typeof id !== 'string' || record['taskId'] || record['stage'] === TurnStage.PostTurn) {
      continue
    }
    const row: TimingTotals = rows.get(id) ?? {
      execution: false, explicit: false, toolCalls: 0, toolDurationMs: 0, modelDurationMs: 0
    }
    rows.set(id, row)

    if (record['goal'] === TurnPhase.Turn && !record['parentId'] && record['startedAt'] !== undefined &&
      Number(record['startedAt']) < until && record['stage'] !== TurnStage.AgentLoop) {
      const owner = record['ownerTurn'] as {
        outcome?: ActivityTurn['outcome']
        version?: string
        context?: unknown
        failure?: OwnerTurnFailureCode
      } | undefined
      if (owner || !options.explicitOwnerOnly) {
        const outcome = owner?.outcome ?? (record['outcome'] === 'completed' ? 'answered' : 'failed')
        const turn = makeTurn(id, record['sessionId'], Number(record['startedAt']),
          measuredNumber(record['durationMs']) ?? 0, outcome)
        const context = readContextUsage(owner?.context)
        if (context) {
          turn.context = context
        }
        if (owner?.version) {
          turn.version = owner.version
        }
        if (owner?.failure && OWNER_TURN_FAILURE_CODES.includes(owner.failure)) {
          turn.failure = owner.failure
        }
        row.turn = turn
        row.explicit = Boolean(owner)
      }
    }
    if (record['goal'] === TurnPhase.Execution) {
      row.execution = true
    }
    if (record['stage'] !== TurnStage.AgentLoop) {
      continue
    }

    const duration = measuredNumber(record['durationMs']) ?? 0
    if (record['kind'] === 'inference') {
      row.modelDurationMs += duration
      const firstOutput = measuredNumber(record['firstOutputMs'])
      if (firstOutput !== undefined) {
        const timestamp = Number(record['startedAt']) + firstOutput
        row.firstOutputAt = Math.min(row.firstOutputAt ?? timestamp, timestamp)
      }
    } else if (record['goal'] === TurnPhase.Tool) {
      row.toolCalls++
      row.toolDurationMs += duration
    }
  }

  for (const [id, row] of rows) {
    if (!row.turn || (!row.execution && !row.explicit)) {
      rows.delete(id)
      continue
    }
    row.turn.modelDurationMs = row.modelDurationMs
    row.turn.toolDurationMs = row.toolDurationMs
    row.turn.toolCalls = row.toolCalls
    if (row.firstOutputAt !== undefined) {
      row.turn.firstOutputMs = Math.max(0, row.firstOutputAt - row.turn.startedAt)
    }
  }

  if (rows.size > 0) {
    for await (const entry of readInferenceUsage(
      { from, until: until + UTC_DAY_MS, stage: TurnStage.AgentLoop }, paths, options.onUnreadableRecord
    )) {
      const turn = entry.turnId ? rows.get(entry.turnId)?.turn : undefined
      if (!turn) {
        continue
      }
      addInference(turn, entry)
    }
  }

  return [...rows.values()].flatMap(({ turn }) => turn ? [turn] : [])
}

function median(sorted: readonly number[]): number | null {
  if (!sorted.length) {
    return null
  }

  const lower = Math.floor((sorted.length - 1) / 2)
  const upper = Math.floor(sorted.length / 2)
  return (sorted[lower]! + sorted[upper]!) / 2
}

function percentile(sorted: number[], fraction: number): number | null {
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? null
}

/**
 * Uses the same paired numerator and denominator for local comparisons and telemetry.
 */
export function summarizeUsage(turns: readonly ActivityTurn[]): UsageSummary {
  const totals = emptyUsage()
  const latencies: number[] = []
  const completeTokens: number[] = []
  const contextSamples: number[] = []
  let fullyMeasuredTokens = 0
  let finishedTurns = 0
  let failedTurns = 0
  let canceledTurns = 0
  let clarificationTurns = 0
  let tokenMeasuredTurns = 0
  let measuredTurnTokens = 0
  let toolCalls = 0
  let durationMs = 0
  let toolDurationMs = 0
  let modelDurationMs = 0
  let firstOutputMs = 0
  let firstOutputCount = 0
  let contextPercent = 0
  let contextCount = 0

  for (const turn of turns) {
    addUsage(totals, turn)
    toolCalls += turn.toolCalls
    durationMs += turn.durationMs
    toolDurationMs += turn.toolDurationMs
    modelDurationMs += turn.modelDurationMs
    if (turn.context?.contextUsagePercent !== undefined && !turn.context.contextUsageEstimated) {
      contextPercent += turn.context.contextUsagePercent
      contextCount++
      contextSamples.push(turn.context.contextUsagePercent)
    }
    if (turn.firstOutputMs !== undefined) {
      firstOutputMs += turn.firstOutputMs
      firstOutputCount++
    }
    failedTurns += Number(turn.outcome === 'failed')
    canceledTurns += Number(turn.outcome === 'canceled')
    clarificationTurns += Number(turn.outcome === 'clarification')
    const tokens = turn.modelCalls > 0 && turn.meteredCalls === turn.modelCalls
      ? turn.inputTokens + turn.outputTokens : undefined
    if (tokens !== undefined) {
      completeTokens.push(tokens)
      fullyMeasuredTokens += tokens
    }
    if (turn.outcome === 'answered') {
      finishedTurns++
      latencies.push(turn.durationMs)
      if (tokens !== undefined) {
        tokenMeasuredTurns++
        measuredTurnTokens += tokens
      }
    }
  }

  latencies.sort((a, b) => a - b)
  completeTokens.sort((a, b) => a - b)
  contextSamples.sort((a, b) => a - b)
  return {
    ...totals, turns: turns.length, finishedTurns, failedTurns, canceledTurns, clarificationTurns,
    tokenMeasuredTurns, measuredTurnTokens,
    fullyMeasuredTurns: completeTokens.length, fullyMeasuredTokens,
    medianTurnTokens: median(completeTokens), p95TurnTokens: percentile(completeTokens, 0.95),
    medianContextPercent: median(contextSamples), p95ContextPercent: percentile(contextSamples, 0.95),
    medianAnswerMs: median(latencies), p95AnswerMs: percentile(latencies, 0.95),
    toolCalls, durationMs, modelDurationMs, toolDurationMs,
    firstOutputMs, firstOutputCount, contextPercent, contextCount
  }
}

function toTurnView(turn: ActivityTurn): UsageTurnView {
  const {
    modelCalls, failedModelCalls, meteredCalls, tokenReportedCalls, inputTokens, outputTokens,
    cachedInputTokens, cacheReportedCalls, cacheComparableInputTokens, cacheComparableCachedTokens, cacheComparableCalls, startedAt, durationMs, outcome, toolCalls,
    toolDurationMs, modelDurationMs, firstOutputMs, context, primaryModel, version
  } = turn

  return {
    modelCalls, failedModelCalls, meteredCalls, tokenReportedCalls, inputTokens, outputTokens, cachedInputTokens,
    cacheReportedCalls, cacheComparableInputTokens, cacheComparableCachedTokens, cacheComparableCalls, startedAt, durationMs, outcome, toolCalls, toolDurationMs, modelDurationMs,
    ...(firstOutputMs === undefined ? {} : { firstOutputMs }),
    ...(context ? { context } : {}),
    ...(version ? { version } : {}),
    provider: primaryModel?.provider ?? null, model: primaryModel?.model ?? null
  }
}

function findRepeatedFirstTurns(turns: ActivityTurn[]): InsightsUsage['repeatedQueries'] {
  const groups = new Map<string, { message: string, turns: UsageTurnView[] }>()
  for (const turn of turns.slice(0, REPEAT_CANDIDATE_LIMIT)) {
    if (!turn.sessionId) {
      continue
    }
    // Resolve the browser request ID in the full session so the Insights date
    // and model filters cannot make a follow-up look like a first turn.
    const owner = CONVERSATION_REPOSITORY.readMessage(turn.sessionId, turn.id, {
      summary: true, firstOwnerOnly: true
    })
    if (owner?.who !== 'owner' || !owner.message) {
      continue
    }
    const message = owner.message.trim()
    if (!message) {
      continue
    }
    const key = message.toLowerCase()
    const group = groups.get(key) ?? { message, turns: [] }
    group.turns.push(toTurnView(turn))
    groups.set(key, group)
  }

  return [...groups.values()]
    .filter((group) => group.turns.length > 1)
    .sort((a, b) => b.turns.length - a.turns.length)
    .slice(0, REPEAT_GROUP_LIMIT)
    .map(({ message, turns: matches }) => ({
      message: message.length > REPEAT_MESSAGE_LIMIT ? `${message.slice(0, REPEAT_MESSAGE_LIMIT)}…` : message,
      occurrences: matches.length,
      turns: matches.length > REPEAT_TURN_LIMIT
        ? [...matches.slice(0, REPEAT_TURN_LIMIT / 2), ...matches.slice(-REPEAT_TURN_LIMIT / 2)]
        : matches
    }))
}

function intervalStart(timestamp: number, interval: InsightsInterval): number {
  const day = Math.floor(timestamp / UTC_DAY_MS) * UTC_DAY_MS
  const date = new Date(day)
  if (interval === 'month') {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
  }
  if (interval === 'week') {
    return day - ((date.getUTCDay() + 6) % 7) * UTC_DAY_MS
  }
  return day
}

function bucketActivity(
  turns: readonly ActivityTurn[], interval: InsightsInterval, offset = 0
): Map<number, ActivityTurn[]> {
  const buckets = new Map<number, ActivityTurn[]>()
  for (const turn of turns) {
    const start = intervalStart(turn.startedAt + offset, interval)
    const bucket = buckets.get(start) ?? []
    bucket.push(turn)
    buckets.set(start, bucket)
  }
  return buckets
}

function contextModel(turn: ActivityTurn): Pick<ModelUsage, 'provider' | 'model'> | undefined {
  if (!turn.context) {
    return undefined
  }
  // Older snapshots have clear attribution only when one model was recorded.
  return turn.context.contextTarget ?? (turn.models.size === 1 ? turn.primaryModel : undefined)
}

/**
 * Compares equal UTC periods and matches repeated wording from first turns in the profile.
 */
export async function getInsightsUsage({
  days = 30, provider, model, repeated = false, interval = 'day', contextPage
}: {
  days?: number
  provider?: string
  model?: string
  repeated?: boolean
  interval?: InsightsInterval
  contextPage?: number
}): Promise<InsightsUsage> {
  const until = Date.now()
  const today = Math.floor(until / UTC_DAY_MS) * UTC_DAY_MS
  const from = today - (days - 1) * UTC_DAY_MS
  const previousFrom = from - days * UTC_DAY_MS
  let unreadableRecords = 0
  // Local charts can still show readable history when older journal entries are damaged.
  const all = await readUsageTurns(previousFrom, until, {
    onUnreadableRecord: () => {
      unreadableRecords++
    }
  })

  if (contextPage !== undefined || repeated) {
    // Saved answers can retain occupancy even when the timing journal has no
    // context snapshot. Recover it only for local, profile-owned views.
    for (const turn of all) {
      if (!turn.context && turn.sessionId) {
        const context = readContextUsage(CONVERSATION_REPOSITORY.readAnswerMetrics(turn.sessionId, turn.id))
        if (context) {
          turn.context = context
        }
      }
    }
  }

  const matchesModel = (turn: ActivityTurn): boolean => {
    const target = contextPage !== undefined ? contextModel(turn) : turn.primaryModel
    return (!provider || target?.provider === provider) && (!model || target?.model === model)
  }
  const current = all.filter((turn) => turn.startedAt >= from && matchesModel(turn))
  const previousUntil = until - days * UTC_DAY_MS
  const previous = all.filter((turn) => turn.startedAt < previousUntil && matchesModel(turn))
  const buckets = bucketActivity(current, interval)
  const precedingBuckets = bucketActivity(previous, interval, days * UTC_DAY_MS)
  const displayDays = new Set(Array.from({ length: days }, (_, index) =>
    intervalStart(from + index * UTC_DAY_MS, interval)
  ))
  const models = new Map<string, ModelUsage>()
  const contextModels = new Map<string, Pick<ModelUsage, 'provider' | 'model'>>()

  for (const turn of all) {
    if (turn.startedAt < from) {
      continue
    }
    const snapshotTarget = contextModel(turn)
    if (snapshotTarget) {
      const { provider, model } = snapshotTarget
      contextModels.set(JSON.stringify([provider, model]), { provider, model })
    }
    for (const [key, source] of turn.models) {
      const target = models.get(key) ?? { ...emptyUsage(), provider: source.provider, model: source.model }
      addUsage(target, source)
      models.set(key, target)
    }
  }

  const history = [...current].sort((a, b) => b.startedAt - a.startedAt)
  const snapshots = contextPage === undefined ? [] : history.filter((turn) => turn.context)
  const contextPages = Math.ceil(snapshots.length / RECENT_TURN_LIMIT)
  const page = contextPages ? Math.min(contextPage ?? 0, contextPages - 1) : 0
  const offset = page * RECENT_TURN_LIMIT

  return {
    firstOwnerMessageAt: CONVERSATION_REPOSITORY.readFirstOwnerMessageAt(),
    unreadableRecords,
    current: summarizeUsage(current),
    previous: summarizeUsage(previous),
    series: [...displayDays].map((day) => ({
      day, ...summarizeUsage(buckets.get(day) ?? []),
      previous: summarizeUsage(precedingBuckets.get(day) ?? [])
    })),
    models: [...models.values()].sort((a, b) => b.modelCalls - a.modelCalls),
    contextModels: [...contextModels.values()],
    contextPage: page, contextPages,
    recentTurns: (contextPage === undefined ? history : snapshots)
      .slice(offset, offset + RECENT_TURN_LIMIT).map(toTurnView),
    repeatedQueries: repeated ? findRepeatedFirstTurns(history) : []
  }
}
