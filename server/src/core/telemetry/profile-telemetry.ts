import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import PACKAGE from '@@/package.json' with { type: 'json' }
import { CONFIG_MANAGER } from '@/config'
import { IS_CI, LEON_FILE_PATH, TELEMETRY_COLLECTOR_ORIGIN } from '@/constants'
import { LEON_HOME_PATH, LEON_PROFILES_PATH, isValidProfileName } from '@/leon-roots'
import { getActiveProfileName, runWithProfileContext } from '@/core/profile-runtime/profile-context'
import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import { summarizeCompletedOwnerTurn, summarizeUsage } from '@/core/insights/usage'
import { onCompletedMaintenance, onCompletedOwnerTurn, onStandaloneSkill, type CompletedOwnerTurn } from '@/core/turn-lifecycle/observability/timing'
import { TurnStage, type OwnerTurnFailureCode } from '@/core/turn-lifecycle/observability/timing-contract'
import type { TelemetrySetting } from '@/core/insights/insights-contract'
import { DateHelper } from '@/helpers/date-helper'
import { FileHelper } from '@/helpers/file-helper'
import { LLMProviders } from '@/core/llm-manager/types'
import { measurePulse, startPulseMeasurements, takePulseMeasurements } from './pulse-measurements'
import { summarizeSessionActivity } from './session-activity'
import { summarizeTurnDiagnostics } from './turn-diagnostics'
import {
  DAILY_REPORT_PATH, getIanaTimeZone, getPublicModel, getSessionActivityId,
  isMaintenanceReport, isPulseReport, isSessionActivityReport, isTelemetryEventReport, OTHER_MODEL, OTHER_PROVIDER,
  LATENCY_BUCKETS_MS, PRESENCE_INTERVAL_MS, PRESENCE_REPORT_PATH, TELEMETRY_DAY_MS, TELEMETRY_EVENT_PATH,
  MAINTENANCE_REASONS, MAINTENANCE_TASKS, TELEMETRY_MAX_MAINTENANCE_BUCKETS, TELEMETRY_MAX_MODEL_BUCKETS,
  TELEMETRY_MINUTE_MS, TELEMETRY_RETRY_DAYS, TELEMETRY_SCHEMA_VERSION,
  PulseTimingMetric, type CapabilityUsage, type DailyReport, type FleetReport, type PresenceReport,
  type MaintenanceMetric, type MaintenanceReport, type PulseReport, type SessionActivityReport, type TelemetryEventReport
} from './report-contract'

const REPORT_ENDPOINT = new URL(DAILY_REPORT_PATH, TELEMETRY_COLLECTOR_ORIGIN).href
const EVENT_ENDPOINT = new URL(TELEMETRY_EVENT_PATH, TELEMETRY_COLLECTOR_ORIGIN).href
const PRESENCE_ENDPOINT = new URL(PRESENCE_REPORT_PATH, TELEMETRY_COLLECTOR_ORIGIN).href
const REQUEST_TIMEOUT_MS = 5_000
const RETRY_INTERVAL_MS = 30_000
const MAXIMUM_PENDING_EVENTS = 256
const MAXIMUM_CONCURRENT_UPLOADS = 4
const DELIVERY_STATE_FILE = 'telemetry-state.json'
const INSTALLATION_KEY_FILE = path.join(LEON_HOME_PATH, '.telemetry-key.json')
const SERVER_OS = process.platform === 'linux' || process.platform === 'darwin' || process.platform === 'win32'
  ? process.platform : 'other'
const active = new Map<AbortController, string>()
const changingSettings = new Map<string, Promise<void>>()
const preparing = new Map<string, Promise<DeliveryState | undefined>>()
const maintenanceBatches = new Map<string, Map<string, MaintenanceMetric>>()
let presenceAbort: AbortController | undefined

type Activity = ReturnType<typeof summarizeCompletedOwnerTurn>
type ReportingInstallation = NonNullable<Awaited<ReturnType<typeof getReportingInstallation>>>
type QueuedReport = TelemetryEventReport | PulseReport | SessionActivityReport | MaintenanceReport

interface PendingEvent {
  profile: string
  at: number
  activity?: Activity
  capabilities?: readonly CapabilityUsage[]
  contextReduction?: CompletedOwnerTurn['contextReduction']
  turnDiagnostics?: TelemetryEventReport['turnDiagnostics']
  client?: TelemetryEventReport['client']
  skillEventId?: string
  pulse?: NonNullable<ReturnType<typeof takePulseMeasurements>>
  maintenance?: MaintenanceMetric[]
  sessionActivity?: true
  retryAt: number
  event?: QueuedReport
}

interface DeliveryState {
  endpoint: string
  enabledAt: number | null
  firstReportingAt: number
  seed: string
}

async function readJSON(filename: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(filename, 'utf8')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

function deliveryStatePath(profile: string): string {
  return path.join(getProfilePaths(profile).root, DELIVERY_STATE_FILE)
}

async function readDeliveryState(profile: string): Promise<DeliveryState | undefined> {
  const state = await readJSON(deliveryStatePath(profile)) as Partial<DeliveryState> | undefined
  if (typeof state?.seed !== 'string' || typeof state.endpoint !== 'string' ||
    !Number.isSafeInteger(state.firstReportingAt) ||
    (state.enabledAt !== null && !Number.isSafeInteger(state.enabledAt))) {
    return undefined
  }

  return state as DeliveryState
}

async function sendReport(
  endpoint: string,
  report: QueuedReport | PresenceReport,
  signal: AbortSignal,
  fallback?: () => QueuedReport | undefined
): Promise<boolean> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'Leon' },
    body: JSON.stringify(report),
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
  })

  await response.body?.cancel()
  if (response.status === 400) {
    const legacy = fallback?.()
    if (legacy) {
      return sendReport(endpoint, legacy, signal)
    }
  }

  return response.ok
}

/**
 * Keeps outcome totals deliverable while collectors learn the optional diagnostics.
 */
function legacyFailureReport(report: QueuedReport): QueuedReport | undefined {
  if (report.kind === 'pulse_metrics') {
    const { tick_finished: tickFinished, ...counters } = report.counters
    if (tickFinished === undefined && !report.buildCommit &&
      !report.failures?.some(({ causeCode, diagnosticId }) => causeCode || diagnosticId)) {
      return undefined
    }

    const legacy = {
      ...report, counters,
      ...(report.failures ? {
        failures: report.failures.map(({ code, count, inference, scope }) => ({
          code, count, scope, ...(inference ? { inference } : {})
        }))
      } : {})
    }

    delete legacy.buildCommit
    return legacy
  }
  if (report.kind !== 'turn_finished' || !report.turnDiagnostics) {
    return undefined
  }

  let changed = false
  const turnDiagnostics = report.turnDiagnostics.map((diagnostic) => {
    const { code, diagnosticId, inference, ...base } = diagnostic
    const legacyCode = code === 'connection_refused' ? 'connection' : code === 'empty_response' ? 'no_output' :
      code === 'provider_startup' || code === 'model_load' ? 'provider_error' : code
    const legacyInference = base.kind === 'attempt' ? inference : undefined
    changed ||= legacyCode !== code || diagnosticId !== undefined || legacyInference !== inference

    return { ...base, code: legacyCode, ...(legacyInference ? { inference: legacyInference } : {}) }
  })

  return changed ? { ...report, turnDiagnostics } : undefined
}

async function syncDeliveryState(
  profile: string, enabled: boolean, now: number
): Promise<DeliveryState | undefined> {
  const previous = await readDeliveryState(profile)
  if (!enabled) {
    if (previous && previous.enabledAt !== null) {
      await FileHelper.writeAtomicJSON(deliveryStatePath(profile), { ...previous, enabledAt: null })
    }
    return undefined
  }

  const sameEndpoint = previous?.endpoint === REPORT_ENDPOINT
  if (sameEndpoint && previous.enabledAt !== null) {
    return previous
  }

  // Start a new window when a profile starts sharing or changes collectors.
  const next: DeliveryState = {
    endpoint: REPORT_ENDPOINT,
    enabledAt: now,
    firstReportingAt: sameEndpoint ? previous.firstReportingAt : now,
    seed: previous?.seed ?? randomBytes(32).toString('hex')
  }
  await FileHelper.writeAtomicJSON(deliveryStatePath(profile), next)

  return next
}

/**
 * Reads the profile's sharing preference from YAML.
 */
export function getTelemetrySetting(profile = getActiveProfileName()): TelemetrySetting {
  const config = CONFIG_MANAGER.getConfig(profile)

  return { enabled: config.telemetry_enabled === true }
}

/**
 * Updates the same preference used by config.yml and stops in-flight uploads on disable.
 */
export async function setTelemetrySetting(enabled: boolean, profile = getActiveProfileName()): Promise<TelemetrySetting> {
  const previous = changingSettings.get(profile) ?? Promise.resolve()
  const write = previous.catch(() => undefined).then(async () => {
    if (getTelemetrySetting(profile).enabled === enabled) {
      return
    }

    for (const [controller, name] of active) {
      if (name === profile) {
        controller.abort()
      }
    }
    await preparing.get(profile)?.catch(() => undefined)
    await runWithProfileContext({ profileName: profile }, () =>
      CONFIG_MANAGER.setValue(['telemetry_enabled'], enabled)
    )
    if (!enabled) {
      presenceAbort?.abort()
    }
    takePulseMeasurements(profile)
    maintenanceBatches.delete(profile)
    await syncDeliveryState(profile, enabled, Date.now())
  })

  changingSettings.set(profile, write)
  try {
    await write
  } finally {
    if (changingSettings.get(profile) === write) {
      changingSettings.delete(profile)
    }
  }
  return getTelemetrySetting(profile)
}

async function getInstallationKey(): Promise<string> {
  let key = await readJSON(INSTALLATION_KEY_FILE)
  if (key === undefined) {
    try {
      await FileHelper.writeAtomicJSON(INSTALLATION_KEY_FILE, randomBytes(32).toString('hex'), { exclusive: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
    }
    key = await readJSON(INSTALLATION_KEY_FILE)
  }
  if (typeof key !== 'string' || !key) {
    throw new Error('Telemetry installation key is invalid.')
  }
  return key
}

async function getReportingInstallation(): Promise<{ key: string, installation: string, birthDate?: number } | undefined> {
  const metadata = await readJSON(LEON_FILE_PATH) as { instanceID?: unknown, birthDate?: unknown } | undefined
  if (typeof metadata?.instanceID !== 'string' || !metadata.instanceID) {
    return undefined
  }

  // A known raw Leon ID cannot be matched without the key kept on this installation.
  const key = await getInstallationKey()
  const installation = createHmac('sha256', key).update('telemetry:installation:').update(metadata.instanceID).digest('hex')
  return {
    key, installation,
    ...(typeof metadata.birthDate === 'number' && Number.isSafeInteger(metadata.birthDate) ? { birthDate: metadata.birthDate } : {})
  }
}

/**
 * Attributes telemetry to the published manifest for the running version.
 */
function getPublicBuildCommit(version: string): string | undefined {
  const commit = process.env['LEON_PUBLIC_BUILD_COMMIT']

  return commit && /^[a-f0-9]{40}$/.test(commit) && version === process.env['npm_package_version'] ? commit : undefined
}

function buildFleetReport(
  report: DailyReport, activity: Activity[], birthDate?: number
): FleetReport {
  const turnLatency = Array<number>(LATENCY_BUCKETS_MS.length + 1).fill(0)
  const firstOutputLatency = [...turnLatency]
  const failures = new Map<OwnerTurnFailureCode, number>()
  const birthDay = birthDate === undefined ? -1 : Math.floor(birthDate / TELEMETRY_DAY_MS)
  const recentSetup = birthDate !== undefined &&
    birthDay >= report.day - TELEMETRY_RETRY_DAYS && birthDay <= report.day
  let recoveredTurns = 0
  let firstAnswerMs = Infinity
  const bucket = (histogram: number[], milliseconds: number): void => {
    const index = LATENCY_BUCKETS_MS.findIndex((limit) => milliseconds <= limit)
    const position = index < 0 ? LATENCY_BUCKETS_MS.length : index
    histogram[position] = (histogram[position] ?? 0) + 1
  }

  for (const turn of activity) {
    if (turn.outcome === 'answered') {
      bucket(turnLatency, turn.durationMs)
      recoveredTurns += Number(turn.failedModelCalls > 0)
      if (recentSetup && birthDate !== undefined && turn.startedAt >= birthDate) {
        const elapsed = turn.startedAt + turn.durationMs - birthDate
        firstAnswerMs = Math.min(firstAnswerMs, Math.round(elapsed / TELEMETRY_MINUTE_MS) * TELEMETRY_MINUTE_MS)
      }
    }
    if (turn.firstOutputMs !== undefined) {
      bucket(firstOutputLatency, turn.firstOutputMs)
    }
    if (turn.outcome === 'failed') {
      const code = turn.failure ?? 'unknown'
      failures.set(code, (failures.get(code) ?? 0) + 1)
    }
  }

  const architecture = process.arch
  const buildCommit = getPublicBuildCommit(report.version)
  return {
    os: SERVER_OS,
    architecture: architecture === 'x64' || architecture === 'arm64' ? architecture : 'other',
    ...(buildCommit ? { buildCommit } : {}),
    turnLatency, firstOutputLatency, recoveredTurns,
    activation: {
      ...(recentSetup ? { setupDay: birthDay } : {}),
      ...(firstAnswerMs <= (report.day - birthDay + 2) * TELEMETRY_DAY_MS ? { firstAnswerMs } : {})
    },
    failures: [...failures].map(([code, count]) => ({ code, count }))
  }
}

function buildReport(
  day: number, installation: string, profile: string, firstReportingDay: boolean,
  activity: Activity[]
): DailyReport {
  const totals = summarizeUsage(activity)
  const versions = new Set(activity.map((turn) => turn.version ?? 'unknown'))
  const models = new Map<string, DailyReport['models'][number]>()

  for (const turn of activity) {
    for (const usage of turn.models.values()) {
      let label = getPublicModel(usage.provider, usage.model)
      let key = JSON.stringify(label)
      if (!models.has(key) && models.size >= TELEMETRY_MAX_MODEL_BUCKETS - 1) {
        label = { provider: OTHER_PROVIDER, model: OTHER_MODEL }
        key = JSON.stringify(label)
      }
      const row = models.get(key) ?? {
        ...label, calls: 0, failedCalls: 0, inputTokens: 0, outputTokens: 0,
        cachedInputTokens: 0, cacheReportedCalls: 0
      }
      row.calls += usage.modelCalls
      row.failedCalls += usage.failedModelCalls
      row.inputTokens += usage.inputTokens
      row.outputTokens += usage.outputTokens
      row.cachedInputTokens += usage.cachedInputTokens
      row.cacheReportedCalls += usage.cacheReportedCalls
      models.set(key, row)
    }
  }

  return {
    schemaVersion: TELEMETRY_SCHEMA_VERSION, installation, profile, day, firstReportingDay,
    version: versions.size > 1 ? 'mixed' : (versions.values().next().value ?? PACKAGE.version),
    turns: totals.turns, answered: totals.finishedTurns,
    failed: totals.failedTurns, canceled: totals.canceledTurns, clarifications: totals.clarificationTurns,
    ...(totals.blockedTurns ? { blocked: totals.blockedTurns } : {}),
    measuredTurns: totals.tokenMeasuredTurns,
    measuredTurnTokens: totals.measuredTurnTokens, toolCalls: totals.toolCalls,
    toolDurationMs: Math.round(totals.toolDurationMs), modelDurationMs: Math.round(totals.modelDurationMs),
    durationMs: Math.round(totals.durationMs), firstOutputMs: Math.round(totals.firstOutputMs),
    firstOutputCount: totals.firstOutputCount, contextPercent: totals.contextPercent,
    contextCount: totals.contextCount, models: [...models.values()]
  }
}

/**
 * Serializes initialization for simultaneous turns without serializing their uploads.
 */
async function prepareProfile(profile: string, at: number): Promise<DeliveryState | undefined> {
  const current = preparing.get(profile)
  if (current) {
    return current
  }
  const state = syncDeliveryState(profile, true, at)
  preparing.set(profile, state)
  try {
    return await state
  } finally {
    preparing.delete(profile)
  }
}

function getProfilePseudonym(state: DeliveryState, identity: ReportingInstallation): string {
  return createHmac('sha256', identity.key).update('telemetry:profile:')
    .update(identity.installation).update(state.seed).digest('hex')
}

function buildEvent(
  job: PendingEvent, state: DeliveryState, identity: ReportingInstallation
): TelemetryEventReport | PulseReport | MaintenanceReport {
  const { key, installation } = identity
  const pseudonym = getProfilePseudonym(state, identity)
  if (job.pulse) {
    const buildCommit = job.pulse.failures?.length ? getPublicBuildCommit(PACKAGE.version) : undefined

    return { kind: 'pulse_metrics', at: job.at, installation, profile: pseudonym, version: PACKAGE.version,
      id: createHmac('sha256', key).update('telemetry:pulse:').update(pseudonym).update(randomUUID()).digest('hex'),
      ...job.pulse, ...(job.pulse.failures?.length ? { os: SERVER_OS } : {}),
      ...(buildCommit ? { buildCommit } : {}) }
  }
  if (job.maintenance) {
    return {
      kind: 'maintenance_metrics', at: job.at, installation, profile: pseudonym, version: PACKAGE.version, os: SERVER_OS,
      id: createHmac('sha256', key).update('telemetry:maintenance:').update(pseudonym).update(randomUUID()).digest('hex'),
      tasks: job.maintenance
    }
  }
  const kind = job.skillEventId ? 'skill_finished' : job.activity ? 'turn_finished' : 'profile_started'
  const day = Math.floor(job.at / TELEMETRY_DAY_MS)
  const activity = job.activity ? [job.activity] : []
  const report = buildReport(day, installation, pseudonym,
    kind === 'profile_started' && day === Math.floor(state.firstReportingAt / TELEMETRY_DAY_MS), activity)
  report.fleet = buildFleetReport(report, activity, identity.birthDate)

  const zone = runWithProfileContext({ profileName: job.profile }, () => DateHelper.getTimeZone())
  return {
    id: createHmac('sha256', key)
      .update(job.skillEventId ? 'telemetry:skill:' : job.activity ? 'telemetry:turn:' : 'telemetry:profile-start:')
      .update(pseudonym).update(job.skillEventId ?? job.activity?.id ?? String(state.enabledAt)).digest('hex'),
    kind,
    at: job.at,
    timeZone: getIanaTimeZone(zone) ?? getIanaTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? 'UTC',
    ...(job.capabilities?.length ? { capabilities: [...job.capabilities] } : {}),
    ...(job.contextReduction ? { contextReduction: job.contextReduction } : {}),
    ...(job.turnDiagnostics ? { turnDiagnostics: job.turnDiagnostics } : {}),
    ...(job.client ? { client: job.client } : {}),
    report
  }
}

/**
 * Reports turn activity and periodic profile summaries in the background.
 */
export function startProfileTelemetry(): (() => void) | undefined {
  // Disposable CI profiles must not contribute to installation or usage metrics.
  if (IS_CI) {
    return
  }

  const startedAt = Date.now()
  const pending: PendingEvent[] = []
  const announced = new Set<string>()
  const sessionActivityDays = new Map<string, number>()
  let inFlight = 0
  let closed = false
  let presenceTimer: NodeJS.Timeout | undefined
  let identity: Promise<ReportingInstallation | undefined> | undefined
  const stopPulseMeasurements = startPulseMeasurements((profile) => getTelemetrySetting(profile).enabled)

  const getIdentity = (): Promise<ReportingInstallation | undefined> => {
    identity ??= getReportingInstallation().then((value) => {
      if (!value) {
        identity = undefined
      }
      return value
    }, (error: unknown) => {
      identity = undefined
      throw error
    })
    return identity
  }

  const deliver = async (job: PendingEvent, controller: AbortController): Promise<boolean> => {
    await changingSettings.get(job.profile)
    controller.signal.throwIfAborted()
    if (!getTelemetrySetting(job.profile).enabled) {
      announced.delete(job.profile)
      return true
    }

    const state = await prepareProfile(job.profile, startedAt)
    const installation = await getIdentity()
    if (typeof state?.enabledAt !== 'number' || !installation) {
      return false
    }
    if ((job.activity?.startedAt ?? job.at) < state.enabledAt) {
      return true
    }
    if (!job.event && job.sessionActivity) {
      const profile = getProfilePseudonym(state, installation)
      const activity = await summarizeSessionActivity(job.profile, job.at, state.enabledAt, controller.signal)
      job.event = {
        kind: 'session_activity', id: getSessionActivityId(profile, job.at), at: job.at,
        installation: installation.installation, profile, version: PACKAGE.version, activity
      }
    }
    if (!job.event) {
      job.event = buildEvent(job, state, installation)
    }

    const valid = job.event.kind === 'session_activity' ? isSessionActivityReport(job.event) :
      job.event.kind === 'maintenance_metrics' ? isMaintenanceReport(job.event) :
        job.event.kind === 'pulse_metrics' ? isPulseReport(job.event) : isTelemetryEventReport(job.event)
    if (!valid) {
      return true
    }
    controller.signal.throwIfAborted()
    const event = job.event

    return sendReport(EVENT_ENDPOINT, event, controller.signal, () => legacyFailureReport(event))
  }

  const drain = (): void => {
    while (!closed && inFlight < MAXIMUM_CONCURRENT_UPLOADS) {
      const now = Date.now()
      const index = pending.findIndex((job) => job.retryAt <= now)
      const job = index < 0 ? undefined : pending.splice(index, 1)[0]
      if (!job) {
        return
      }
      if (job.at < now - TELEMETRY_RETRY_DAYS * TELEMETRY_DAY_MS) {
        continue
      }

      const controller = new AbortController()
      active.set(controller, job.profile)
      inFlight++
      void deliver(job, controller).catch(() => false).then((sent) => {
        if (!sent && !closed && !controller.signal.aborted && pending.length < MAXIMUM_PENDING_EVENTS) {
          job.retryAt = Date.now() + RETRY_INTERVAL_MS
          pending.push(job)
        }
      }).finally(() => {
        active.delete(controller)
        inFlight--
        drain()
      })
    }
  }

  const enqueue = (job: PendingEvent): void => {
    if (!closed && pending.length < MAXIMUM_PENDING_EVENTS) {
      pending.push(job)
      drain()
    }
  }

  const announceProfile = (profile: string, at: number): void => {
    if (!announced.has(profile) && pending.length < MAXIMUM_PENDING_EVENTS) {
      announced.add(profile)
      enqueue({ profile, at, retryAt: 0 })
    }
  }

  const unsubscribe = onCompletedOwnerTurn((completed) => {
    try {
      const { profile, startedAt, durationMs } = completed
      if (!closed && getTelemetrySetting(profile).enabled && pending.length < MAXIMUM_PENDING_EVENTS) {
        const at = startedAt + durationMs
        announceProfile(profile, at)
        const activity = summarizeCompletedOwnerTurn(completed)
        if (completed.pulseQueue) {
          const { model, waitMs, pulseActive } = completed.pulseQueue
          const provider = LLMProviders.LlamaCPP
          measurePulse({ metric: PulseTimingMetric.ForegroundQueue, ms: waitMs, pulseActive, provider, model }, profile)
          if (activity.firstOutputMs !== undefined && activity.primaryModel?.provider === provider &&
            activity.primaryModel.model === model) {
            measurePulse({ metric: PulseTimingMetric.ForegroundOutput, ms: activity.firstOutputMs, pulseActive, provider, model }, profile)
          }
        }
        enqueue({
          profile, at, activity, retryAt: 0,
          client: completed.measurement.client,
          capabilities: completed.capabilities, contextReduction: completed.contextReduction,
          turnDiagnostics: summarizeTurnDiagnostics(completed)
        })
      }
    } catch {
      // Reporting is best-effort and never owns the outcome of a turn.
    }
  })
  const unsubscribeMaintenance = onCompletedMaintenance(({ profile, stage, task, outcome, reason, errorCode }) => {
    try {
      if (closed || (stage !== TurnStage.PreTurn && stage !== TurnStage.PostTurn) || !getTelemetrySetting(profile).enabled) {
        return
      }
      if (outcome === 'skipped' || (outcome === 'completed' && reason !== 'fyi-fallback')) {
        return
      }

      const label = MAINTENANCE_TASKS.find((entry) => entry === task) ?? 'other'
      const publicReason = MAINTENANCE_REASONS.find((entry) => entry === reason) ?? errorCode
      const key = JSON.stringify([stage, label, outcome, publicReason])
      const batch = maintenanceBatches.get(profile) ?? new Map<string, MaintenanceMetric>()
      const row = batch.get(key)
      if (row) {
        row.count++
      } else if (batch.size < TELEMETRY_MAX_MAINTENANCE_BUCKETS) {
        batch.set(key, { stage, task: label, outcome, count: 1, ...(publicReason ? { reason: publicReason } : {}) })
      }
      maintenanceBatches.set(profile, batch)
    } catch {
      // Telemetry never owns maintenance outcomes.
    }
  })
  const unsubscribeSkill = onStandaloneSkill((profile, entry) => {
    try {
      if (!closed && getTelemetrySetting(profile).enabled) {
        const at = Date.now()
        announceProfile(profile, at)
        enqueue({ profile, at, capabilities: [entry], skillEventId: randomUUID(), retryAt: 0 })
      }
    } catch {
      // Reporting is best-effort and never owns the outcome of a skill action.
    }
  })

  const pulse = async (): Promise<void> => {
    const controller = new AbortController()
    presenceAbort = controller
    try {
      const profiles = await fs.readdir(LEON_PROFILES_PATH, { withFileTypes: true })
      let sharing = false
      for (const profile of profiles) {
        if (!profile.isDirectory() || !isValidProfileName(profile.name)) {
          continue
        }
        try {
          if (getTelemetrySetting(profile.name).enabled) {
            sharing = true
            const at = Date.now()
            announceProfile(profile.name, at)
            if (pending.length < MAXIMUM_PENDING_EVENTS) {
              const pulse = takePulseMeasurements(profile.name)
              if (pulse) {
                enqueue({ profile: profile.name, at, pulse, retryAt: 0 })
              }
            }
            const maintenance = maintenanceBatches.get(profile.name)
            if (maintenance?.size && pending.length < MAXIMUM_PENDING_EVENTS) {
              maintenanceBatches.delete(profile.name)
              enqueue({ profile: profile.name, at, maintenance: [...maintenance.values()], retryAt: 0 })
            }
            const day = Math.floor(at / TELEMETRY_DAY_MS)
            if (sessionActivityDays.get(profile.name) !== day && pending.length < MAXIMUM_PENDING_EVENTS) {
              sessionActivityDays.set(profile.name, day)
              enqueue({ profile: profile.name, at, sessionActivity: true, retryAt: 0 })
            }
          } else {
            announced.delete(profile.name)
            takePulseMeasurements(profile.name)
            maintenanceBatches.delete(profile.name)
          }
        } catch {
          continue
        }
      }
      const installation = sharing && !closed ? await getIdentity() : undefined
      if (installation && !closed) {
        const timeZone = getIanaTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
        await sendReport(PRESENCE_ENDPOINT, {
          installation: installation.installation,
          ...(timeZone ? { timeZone } : {})
        }, controller.signal)
      }
    } finally {
      presenceAbort = undefined
      if (!closed) {
        presenceTimer = setTimeout(() => void pulse().catch(() => undefined), PRESENCE_INTERVAL_MS)
        presenceTimer.unref()
      }
    }
  }

  void pulse().catch(() => undefined)
  const retryTimer = setInterval(drain, RETRY_INTERVAL_MS)
  retryTimer.unref()

  return () => {
    closed = true
    stopPulseMeasurements()
    unsubscribe()
    unsubscribeSkill()
    unsubscribeMaintenance()
    maintenanceBatches.clear()
    pending.length = 0
    clearInterval(retryTimer)
    clearTimeout(presenceTimer)
    presenceAbort?.abort()
    for (const controller of active.keys()) {
      controller.abort()
    }
  }
}
