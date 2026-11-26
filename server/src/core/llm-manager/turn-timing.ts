import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import path from 'node:path'

import PACKAGE from '@@/package.json' with { type: 'json' }
import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import { LogHelper } from '@/helpers/log-helper'
import type { CompletionAttemptTiming } from './types'
import { TurnPhase, TurnStage, isToolPreparationPhase, type TurnTiming, type TurnTimingContext, type InferenceActivity, OwnerTurnFailureCode  } from './turn-timing-contract'
import { readContextUsage, type ContextUsageMetrics } from './llm-usage/context-usage'
import type { InferenceUsage } from './llm-usage/usage-context'
import type { InferenceUsageRecord } from './llm-usage/usage-ledger'
import { TELEMETRY_MAX_CAPABILITY_BUCKETS, type CapabilityUsage } from '@/core/telemetry/report-contract'
import { getTurnClient } from '@/core/leon-interface/turn-client'
import type { TurnClient } from '@@/bridges/runtime/contracts/turn-client'

export { TurnPhase, TurnStage, type TurnTiming, type TurnTimingContext } from './turn-timing-contract'

interface OwnerTurnMeasurement {
  version: string
  client: TurnClient
  outcome: 'answered' | 'clarification' | 'failed' | 'canceled'
  context?: ContextUsageMetrics
  failure?: OwnerTurnFailureCode
}

export interface CompletedOwnerTurn {
  id: string
  profile: string
  startedAt: number
  durationMs: number
  measurement: OwnerTurnMeasurement
  timings: readonly TurnTiming[]
  inferenceUsage: readonly ForegroundInferenceUsage[]
  capabilities: readonly CapabilityUsage[]
  contextReduction: { count: number, estimatedTokensReclaimed: number }
  pulseQueue?: PulseQueueSample
}

interface PulseQueueSample { model: string, waitMs: number, pulseActive: boolean }
type ForegroundInferenceUsage = Pick<InferenceUsageRecord, 'provider' | 'model' | 'outcome' | 'usage'>

const MAXIMUM_TURN_TIMINGS = 10_000

export interface MaintenanceTaskResult {
  outcome: 'completed' | 'skipped' | 'rejected' | 'failed'
  // Diagnostics contain fixed reason codes and counts, never model-returned facts.
  reason?: string
  issueCount?: number
}

interface TurnTimingScope extends TurnTimingContext {
  profile: string
  parentId?: string
  onActivity?: (activity: InferenceActivity) => void
  state: {
    sessionId: string | null
    timings: Map<string, TurnTiming>
    closed: boolean
    omitted: number
    ownerTurn?: OwnerTurnMeasurement
    inferenceUsage?: ForegroundInferenceUsage[]
    capabilities?: Map<string, CapabilityUsage>
    contextReduction?: CompletedOwnerTurn['contextReduction']
    pulseQueue?: PulseQueueSample
  }
}

const storage = new AsyncLocalStorage<TurnTimingScope | undefined>()
const pendingWrites = new Map<string, Promise<void>>()
const ownerTurnListeners = new Set<(turn: CompletedOwnerTurn) => void>()
const standaloneSkillListeners = new Set<(profile: string, entry: CapabilityUsage) => void>()

/**
 * Observes completed foreground owner turns without awaiting subscriber work.
 */
export function onCompletedOwnerTurn(listener: (turn: CompletedOwnerTurn) => void): () => void {
  ownerTurnListeners.add(listener)
  return () => {
    ownerTurnListeners.delete(listener)
  }
}

/**
 * Observes controlled skill actions that run outside the agent loop.
 */
export function onStandaloneSkill(listener: (profile: string, entry: CapabilityUsage) => void): () => void {
  standaloneSkillListeners.add(listener)
  return () => {
    standaloneSkillListeners.delete(listener)
  }
}

/**
 * Measures the first local admission within a foreground turn.
 */
export function recordPulseQueueSample(sample: PulseQueueSample): void {
  const scope = storage.getStore()
  if (ownerTurnListeners.size && scope?.stage === TurnStage.AgentLoop && !scope.taskId && !scope.state.closed) {
    scope.state.pulseQueue ??= sample
  }
}

/**
 * Counts only capability labels already classified against the public catalog.
 */
export function recordCapabilityUsage(entry: CapabilityUsage): void {
  const scope = storage.getStore()
  if (!scope && entry.kind === 'native_skill') {
    const profile = getActiveProfileName()
    for (const listener of standaloneSkillListeners) {
      queueMicrotask(() => listener(profile, entry))
    }
    return
  }
  if (!scope || scope.state.closed || scope.taskId || scope.stage === TurnStage.PostTurn || !ownerTurnListeners.size) {
    return
  }

  scope.state.capabilities ??= new Map()
  const { calls, failed, durationMs, ...label } = entry
  const key = JSON.stringify(label)
  const previous = scope.state.capabilities.get(key)
  if (previous) {
    previous.calls += calls
    previous.failed += failed
    if (durationMs !== undefined) {
      previous.durationMs = (previous.durationMs ?? 0) + durationMs
    }
  } else if (scope.state.capabilities.size < TELEMETRY_MAX_CAPABILITY_BUCKETS) {
    scope.state.capabilities.set(key, { ...entry })
  }
}

/**
 * Measures local prompt reduction using the same estimate before and after preparation.
 */
export function recordForegroundContextReduction(tokensReclaimed: number): void {
  const scope = storage.getStore()
  if (!ownerTurnListeners.size || !scope || scope.state.closed || scope.stage !== TurnStage.AgentLoop ||
    !Number.isSafeInteger(tokensReclaimed) || tokensReclaimed <= 0) {
    return
  }

  const reduction = scope.state.contextReduction ??= { count: 0, estimatedTokensReclaimed: 0 }
  reduction.count++
  reduction.estimatedTokensReclaimed += tokensReclaimed
}

/**
 * Observes only this foreground execution. Fresh background timing scopes do not
 * inherit the listener, and detached work cannot emit after execution finishes.
 */
export async function observeTurnActivities<T>(
  onActivity: (activity: InferenceActivity) => void,
  execute: () => Promise<T>
): Promise<T> {
  const scope = storage.getStore()
  if (!scope) {
    return execute()
  }
  let active = true

  try {
    return await storage.run({
      ...scope,
      onActivity: (activity): void => {
        if (active) {
          onActivity(activity)
        }
      }
    }, execute)
  } finally {
    active = false
  }
}

function notifyActivity(scope: TurnTimingScope, timing: TurnTiming): void {
  if (!scope.onActivity || scope.state.closed) {
    return
  }

  try {
    scope.onActivity({
      id: timing.id,
      goal: timing.goal,
      kind: timing.kind,
      ...(timing.subject ? { subject: timing.subject } : {}),
      startedAt: timing.startedAt,
      durationMs: timing.durationMs,
      outcome: timing.outcome
    })
  } catch {
    // A disconnected progress consumer must never fail the model request.
    LogHelper.warning('Could not publish turn activity.')
  }
}

/**
 * Serializes concurrent turns targeting the same daily file so large append
 * batches cannot interleave partial JSON lines. Idle file queues are released.
 */
async function appendTimingRecords(filename: string, contents: string): Promise<void> {
  const previous = pendingWrites.get(filename) ?? Promise.resolve()
  const write = previous.catch(() => undefined).then(async () => {
    await fs.mkdir(path.dirname(filename), { recursive: true })
    await fs.appendFile(filename, contents, 'utf8')
  })
  pendingWrites.set(filename, write)
  try {
    await write
  } finally {
    if (pendingWrites.get(filename) === write) {
      pendingWrites.delete(filename)
    }
  }
}

/**
 * Associates setup work with the session once request initialization resolves it.
 */
export function setTurnTimingSession(sessionId: string): void {
  const scope = storage.getStore()
  if (scope) {
    scope.state.sessionId = sessionId
  }
}

/**
 * Distinguishes accepted owner answers from background work and failed dispatches.
 */
export function recordOwnerTurn(
  outcome: OwnerTurnMeasurement['outcome'],
  metrics?: unknown,
  failure?: OwnerTurnFailureCode
): void {
  const scope = storage.getStore()
  if (scope && !scope.state.closed) {
    const context = readContextUsage(metrics)
    scope.state.ownerTurn = { version: PACKAGE.version, client: getTurnClient(), outcome, ...(context ? { context } : {}),
      ...(failure && outcome === 'failed' ? { failure } : {}) }
  }
}

/**
 * Captures one measured phase without changing synchronous or async call semantics.
 */
export function runTurnPhase<T>(goal: TurnPhase, execute: () => T, details?: { subject: string }): T {
  const scope = storage.getStore()
  if (!scope || scope.state.closed) {
    return execute()
  }
  const id = randomUUID()
  const timing: TurnTiming = {
    stage: goal === TurnPhase.Execution ? TurnStage.AgentLoop : scope.stage,
    id, ...(scope.parentId ? { parentId: scope.parentId } : {}),
    kind: 'phase', goal, ...details, startedAt: Date.now(), durationMs: 0, outcome: 'started'
  }
  if (scope.state.timings.size >= MAXIMUM_TURN_TIMINGS) {
    scope.state.omitted++
    return execute()
  }
  scope.state.timings.set(id, timing)
  const visible = isToolPreparationPhase(goal)
  if (visible) {
    notifyActivity(scope, timing)
  }
  const finish = (outcome: string): void => {
    if (scope.state.closed) {
      return
    }
    timing.durationMs = Math.max(0, Date.now() - timing.startedAt)
    timing.outcome = outcome
    if (visible) {
      notifyActivity(scope, timing)
    }
  }

  try {
    const result = storage.run({
      ...scope,
      parentId: id,
      stage: goal === TurnPhase.Execution ? TurnStage.AgentLoop : scope.stage
    }, execute)
    if (result instanceof Promise) {
      return result.then((value) => {
        finish('completed')
        return value
      }, (error: unknown) => {
        finish('failed')
        throw error
      }) as T
    }
    finish('completed')
    return result
  } catch (error) {
    finish('failed')
    throw error
  }
}

/**
 * Labels a request using its actual result, not guesses from its text or position.
 */
export function setTurnPhaseGoal(goal: TurnPhase): void {
  const scope = storage.getStore()
  if (!scope || scope.state.closed) {
    return
  }
  const timing = scope.parentId ? scope.state.timings.get(scope.parentId) : undefined
  if (timing && timing.goal !== goal) {
    timing.goal = goal
    for (const child of scope.state.timings.values()) {
      if (child.parentId === timing.id && child.kind === 'inference') {
        child.goal = goal
        notifyActivity(scope, child)
      }
    }
  }
}

/**
 * Retains metadata for every provider attempt, including retries and auxiliary duties.
 * Prompt text, error bodies and private reasoning never enter timing records.
 */
export function recordTurnInference(timing: CompletionAttemptTiming): void {
  const scope = storage.getStore()
  if (!scope || scope.state.closed) {
    return
  }
  if (!scope.state.timings.has(timing.attemptId) && scope.state.timings.size >= MAXIMUM_TURN_TIMINGS) {
    scope.state.omitted++
    return
  }
  const parent = scope.parentId ? scope.state.timings.get(scope.parentId) : undefined
  const outputTimes = [timing.firstReasoningTokenMs, timing.firstTokenMs, timing.firstToolInputMs]
    .filter((value): value is number => value !== undefined && Number.isFinite(value))
  scope.state.timings.set(timing.attemptId, {
    stage: scope.stage,
    id: timing.attemptId, ...(scope.parentId ? { parentId: scope.parentId } : {}),
    kind: 'inference', goal: parent && parent.goal !== TurnPhase.Turn && parent.goal !== TurnPhase.PostTurn
      ? parent.goal : timing.usagePurpose ?? timing.duty,
    startedAt: timing.startedAt, durationMs: timing.elapsedMs, outcome: timing.outcome,
    duty: timing.duty, ...(timing.usagePurpose ? { purpose: timing.usagePurpose } : {}),
    provider: timing.provider, ...(timing.model ? { model: timing.model } : {}),
    ...(timing.firstCompactionMs === undefined ? {} : {
      firstCompactionMs: timing.firstCompactionMs
    }),
    ...(timing.compactionCount === undefined ? {} : {
      compactionCount: timing.compactionCount
    }),
    ...(timing.compactionDurationMs === undefined ? {} : {
      compactionDurationMs: timing.compactionDurationMs
    }),
    ...(outputTimes.length ? { firstOutputMs: Math.min(...outputTimes) } : {})
  })
  notifyActivity(scope, scope.state.timings.get(timing.attemptId)!)
  if (timing.outcome !== 'started' && outputTimes.length && scope.state.timings.size < MAXIMUM_TURN_TIMINGS - 2) {
    const waitMs = Math.max(0, Math.min(timing.elapsedMs, ...outputTimes))
    for (const [suffix, goal, offset, durationMs] of [
      ['wait', TurnPhase.Wait, 0, waitMs],
      ['stream', TurnPhase.Stream, waitMs, Math.max(0, timing.elapsedMs - waitMs)]
    ] as const) {
      scope.state.timings.set(`${timing.attemptId}:${suffix}`, {
        stage: scope.stage,
        id: `${timing.attemptId}:${suffix}`, parentId: timing.attemptId,
        kind: 'phase', goal, startedAt: timing.startedAt + offset, durationMs, outcome: timing.outcome
      })
    }
  }
}

/**
 * Supplies a content-free snapshot for the persisted conversation trace.
 */
export function getTurnTimings(): TurnTiming[] {
  return [...(storage.getStore()?.state.timings.values() ?? [])].map((timing) => ({ ...timing }))
}

/**
 * Captures content-free ownership before foreground execution or queued work ends.
 */
export function getTurnTimingContext(): TurnTimingContext | undefined {
  const scope = storage.getStore()
  if (!scope || scope.profile !== getActiveProfileName()) {
    return undefined
  }

  return {
    turnId: scope.turnId,
    stage: scope.stage,
    ...(scope.taskId ? { taskId: scope.taskId } : {}),
    ...(scope.task ? { task: scope.task } : {})
  }
}

/**
 * Links provider accounting to the exact attempt without estimating missing counters.
 */
export function recordTurnInferenceUsage(attemptId: string, usageId: string, usage: InferenceUsage): void {
  const scope = storage.getStore()
  const timing = scope?.state.timings.get(attemptId)
  if (timing && !scope?.state.closed) {
    timing.usageId = usageId
    timing.usage = { ...usage }
  }
}

/**
 * Counts foreground inference attempts even when no matching timing interval was emitted.
 */
export function recordForegroundInferenceUsage(entry: ForegroundInferenceUsage): void {
  const scope = storage.getStore()
  if (!ownerTurnListeners.size || !scope || scope.state.closed || scope.stage !== TurnStage.AgentLoop) {
    return
  }
  scope.state.inferenceUsage ??= []
  if (scope.state.inferenceUsage.length < MAXIMUM_TURN_TIMINGS) {
    scope.state.inferenceUsage.push(entry)
  }
}

/**
 * Records maintenance transitions for audit replay, never automatic re-execution.
 */
export async function recordMaintenanceEvent(
  context: TurnTimingContext,
  profile: string,
  sessionId: string | null,
  outcome: 'queued' | 'running' | MaintenanceTaskResult['outcome'],
  details?: Pick<MaintenanceTaskResult, 'reason' | 'issueCount'>
): Promise<void> {
  const startedAt = Date.now()
  const filename = path.join(getProfilePaths(profile).logs, 'turns', `${new Date(startedAt).toISOString().slice(0, 10)}.jsonl`)
  try {
    await appendTimingRecords(filename, `${JSON.stringify({
      ...context, profile, sessionId, kind: 'maintenance', outcome, startedAt,
      ...(details?.reason ? { reason: details.reason } : {}),
      ...(details?.issueCount === undefined ? {} : { issueCount: details.issueCount })
    })}\n`)
  } catch (error) {
    LogHelper.warning(`Could not save maintenance event: ${String(error)}`)
  }
}

/**
 * Streams a profile's recorded lifecycle without rerunning model calls or mutations.
 * Old records without stage/task metadata remain readable by their turn identity.
 */
export async function* readTurnHistory({ from, until, ...query }: {
  from?: number
  until?: number
  turnId?: string
  sessionId?: string
  goal?: TurnPhase
  stage?: TurnStage
  taskId?: string
}, profilePaths = getProfilePaths(), onUnreadableRecord?: () => void): AsyncGenerator<Record<string, unknown>> {
  const directory = path.join(profilePaths.logs, 'turns')
  let filenames: string[]
  try {
    filenames = await fs.readdir(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw error
  }

  const firstDay = from === undefined ? '' : new Date(from).toISOString().slice(0, 10)
  const lastDay = until === undefined ? '' : new Date(until - 1).toISOString().slice(0, 10)
  for (const filename of filenames.sort()) {
    const day = filename.slice(0, 10)
    if (!filename.endsWith('.jsonl') || (firstDay && day < firstDay) || (lastDay && day > lastDay)) {
      continue
    }
    const stream = createReadStream(path.join(directory, filename), { encoding: 'utf8' })
    const lines = createInterface({ input: stream, crlfDelay: Infinity })
    try {
      for await (const line of lines) {
        if (!line.trim()) {
          continue
        }
        let record: Record<string, unknown>
        try {
          record = JSON.parse(line) as Record<string, unknown>
          if (!record || typeof record !== 'object' || Array.isArray(record)) {
            throw new SyntaxError('The timing record is missing its event data.')
          }
        } catch (error) {
          if (!onUnreadableRecord || !(error instanceof SyntaxError)) {
            throw error
          }
          onUnreadableRecord()
          continue
        }

        const timestamp = Number(record['startedAt'])
        if ((from !== undefined && !(timestamp >= from)) ||
          (until !== undefined && !(timestamp < until))) {
          continue
        }
        if (Object.entries(query).every(([key, value]) => value === undefined || record[key] === value)) {
          yield record
        }
      }
    } finally {
      lines.close()
      stream.destroy()
    }
  }
}

/**
 * Keeps queued maintenance outside the completed turn's timing and log ownership.
 */
export function runOutsideTurnTiming<T>(execute: () => T): T {
  return storage.run(undefined, execute)
}

/**
 * Owns one profile-local trace and writes its bounded metadata to UTC daily JSONL.
 * Logging failures must not prevent delivery of the owner's answer.
 */
export async function runWithTurnTiming<T>(
  turnId: string,
  sessionId: string | null,
  execute: () => Promise<T>,
  context?: Omit<TurnTimingContext, 'turnId'>
): Promise<T> {
  const scope: TurnTimingScope = {
    profile: getActiveProfileName(), turnId, stage: TurnStage.PreTurn, ...context,
    state: { sessionId, timings: new Map(), closed: false, omitted: 0 }
  }
  return storage.run(scope, async () => {
    try {
      return await runTurnPhase(scope.stage === TurnStage.PostTurn ? TurnPhase.PostTurn : TurnPhase.Turn, execute)
    } finally {
      scope.state.closed = true
      for (const timing of scope.state.timings.values()) {
        if (timing.outcome === 'started') {
          // Retained background tools may outlive the request. Their parent
          // interval stops at detachment rather than claiming future turn time.
          timing.durationMs = Math.max(0, Date.now() - timing.startedAt)
          timing.outcome = 'detached'
        }
      }
      const timings = getTurnTimings()
      const owner = scope.state.ownerTurn
      const root = owner && !scope.taskId && timings.find((timing) =>
        timing.goal === TurnPhase.Turn && !timing.parentId)
      if (owner && root && ownerTurnListeners.size) {
        const turn = {
          id: turnId, profile: scope.profile, startedAt: root.startedAt,
          durationMs: root.durationMs, measurement: owner, timings,
          inferenceUsage: scope.state.inferenceUsage ?? [],
          capabilities: [...(scope.state.capabilities?.values() ?? [])],
          contextReduction: scope.state.contextReduction ?? { count: 0, estimatedTokensReclaimed: 0 },
          ...(scope.state.pulseQueue ? { pulseQueue: scope.state.pulseQueue } : {})
        }
        // Reporting can use finalized counters as soon as the turn closes.
        runOutsideTurnTiming(() => {
          for (const listener of ownerTurnListeners) {
            queueMicrotask(() => listener(turn))
          }
        })
      }
      try {
        const directory = path.join(getProfilePaths(scope.profile).logs, 'turns')
        const records = new Map<string, string[]>()
        for (const timing of timings) {
          const date = new Date(timing.startedAt).toISOString().slice(0, 10)
          const entries = records.get(date) ?? []
          entries.push(JSON.stringify({
            profile: scope.profile, sessionId: scope.state.sessionId,
            ...getTurnTimingContext(), ...timing,
            ...(timing.goal === TurnPhase.Turn && !timing.parentId && scope.state.ownerTurn
              ? { ownerTurn: scope.state.ownerTurn } : {}),
            endedAt: timing.startedAt + timing.durationMs
          }))
          records.set(date, entries)
        }
        if (scope.state.omitted) {
          const date = new Date().toISOString().slice(0, 10)
          const entries = records.get(date) ?? []
          entries.push(JSON.stringify({ profile: scope.profile, sessionId: scope.state.sessionId, turnId, omitted: scope.state.omitted }))
          records.set(date, entries)
        }
        await fs.mkdir(directory, { recursive: true })
        for (const [date, entries] of records) {
          await appendTimingRecords(path.join(directory, `${date}.jsonl`), `${entries.join('\n')}\n`)
        }
      } catch (error) {
        LogHelper.warning(`Could not save turn timing: ${String(error)}`)
      } finally {
        scope.state.timings.clear()
      }
    }
  })
}
