import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import path from 'node:path'

import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import { LogHelper } from '@/helpers/log-helper'
import type { CompletionAttemptTiming } from './types'
import { TurnPhase, TurnStage, type TurnTiming, type TurnTimingContext } from './turn-timing-contract'
import type { InferenceUsage } from './llm-usage/usage-context'

export { TurnPhase, TurnStage, type TurnTiming, type TurnTimingContext } from './turn-timing-contract'

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
  state: { sessionId: string | null, timings: Map<string, TurnTiming>, closed: boolean, omitted: number }
}

const storage = new AsyncLocalStorage<TurnTimingScope | undefined>()
const pendingWrites = new Map<string, Promise<void>>()

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
 * Captures one measured phase without changing synchronous or async call semantics.
 */
export function runTurnPhase<T>(goal: TurnPhase, execute: () => T): T {
  const scope = storage.getStore()
  if (!scope || scope.state.closed) {
    return execute()
  }
  const id = randomUUID()
  const timing: TurnTiming = {
    stage: goal === TurnPhase.Execution ? TurnStage.AgentLoop : scope.stage,
    id, ...(scope.parentId ? { parentId: scope.parentId } : {}),
    kind: 'phase', goal, startedAt: Date.now(), durationMs: 0, outcome: 'started'
  }
  if (scope.state.timings.size >= MAXIMUM_TURN_TIMINGS) {
    scope.state.omitted++
    return execute()
  }
  scope.state.timings.set(id, timing)
  const finish = (outcome: string): void => {
    timing.durationMs = Math.max(0, Date.now() - timing.startedAt)
    timing.outcome = outcome
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
  if (timing) {
    timing.goal = goal
    for (const child of scope.state.timings.values()) {
      if (child.parentId === timing.id && child.kind === 'inference') {
        child.goal = goal
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
    ...(outputTimes.length ? { firstOutputMs: Math.min(...outputTimes) } : {})
  })
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
export async function* readTurnHistory(query: {
  turnId?: string
  sessionId?: string
  stage?: TurnStage
  taskId?: string
}): AsyncGenerator<Record<string, unknown>> {
  const directory = path.join(getProfilePaths().logs, 'turns')
  let filenames: string[]
  try {
    filenames = await fs.readdir(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw error
  }

  for (const filename of filenames.sort()) {
    if (!filename.endsWith('.jsonl')) {
      continue
    }
    const stream = createReadStream(path.join(directory, filename), { encoding: 'utf8' })
    const lines = createInterface({ input: stream, crlfDelay: Infinity })
    try {
      for await (const line of lines) {
        if (!line.trim()) {
          continue
        }
        const record = JSON.parse(line) as Record<string, unknown>
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
      try {
        const directory = path.join(getProfilePaths(scope.profile).logs, 'turns')
        const timings = getTurnTimings()
        const records = new Map<string, string[]>()
        for (const timing of timings) {
          const date = new Date(timing.startedAt).toISOString().slice(0, 10)
          const entries = records.get(date) ?? []
          entries.push(JSON.stringify({
            profile: scope.profile, sessionId: scope.state.sessionId,
            ...getTurnTimingContext(), ...timing,
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
