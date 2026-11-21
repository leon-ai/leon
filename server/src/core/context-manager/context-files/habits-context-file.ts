import path from 'node:path'

import { DateHelper } from '@/helpers/date-helper'
import { ContextFile } from '@/core/context-manager/context-file'
import {
  ContextProbeHelper,
  RunningProcessEntry
} from '@/core/context-manager/context-probe-helper'
import { ContextStateStore, normalizeSampleTime } from '@/core/context-manager/context-state-store'

type DayBucket =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday'
type TimeBucket = 'night' | 'morning' | 'afternoon' | 'evening'

interface HabitsState {
  trackingStartedAt: string
  lastSampleAt: string
  sampledSeconds: number
  timeBuckets: Record<TimeBucket, Record<string, number>>
  dayBuckets: Record<DayBucket, Record<string, number>>
}

const EMPTY_TIME_BUCKETS: Record<TimeBucket, Record<string, number>> = {
  night: {},
  morning: {},
  afternoon: {},
  evening: {}
}
const EMPTY_DAY_BUCKETS: Record<DayBucket, Record<string, number>> = {
  monday: {},
  tuesday: {},
  wednesday: {},
  thursday: {},
  friday: {},
  saturday: {},
  sunday: {}
}
const FALLBACK_STATE: HabitsState = {
  trackingStartedAt: '',
  lastSampleAt: '',
  sampledSeconds: 0,
  timeBuckets: EMPTY_TIME_BUCKETS,
  dayBuckets: EMPTY_DAY_BUCKETS
}

const MAX_APP_LINES = 20
const MAX_BUCKET_LINES = 16
const MAX_STATE_APPS_PER_BUCKET = 250
const MEDIUM_CONFIDENCE_SECONDS = 6 * 3_600
const HIGH_CONFIDENCE_SECONDS = 24 * 3_600

export class HabitsContextFile extends ContextFile {
  public readonly filename = 'HABITS.md'
  public readonly ttlMs: number

  private readonly stateStore = new ContextStateStore<HabitsState>(
    '.habits-state.json',
    FALLBACK_STATE
  )

  public constructor(
    private readonly probeHelper: ContextProbeHelper,
    ttlMs: number
  ) {
    super()
    this.ttlMs = ttlMs
  }

  public generate(): string {
    const now = new Date()
    const currentTimeBucket = this.getTimeBucket(now)
    const currentDayBucket = this.getDayBucket(now)
    const runningProcesses = this.probeHelper.probeRunningProcesses(120)
    const activeApps = this.aggregateActiveApps(runningProcesses.entries)

    const currentState = this.normalizeState(this.stateStore.load())
    const updatedState = this.updateState(
      currentState,
      activeApps,
      currentTimeBucket,
      currentDayBucket,
      now
    )
    this.stateStore.save(updatedState)

    const globalTopApps = this.getTopAppsFromBuckets(updatedState.timeBuckets)
    const currentWindowTopApps = this.getTopAppsFromSingleBucket(
      updatedState.timeBuckets[currentTimeBucket]
    )
    const currentDayTopApps = this.getTopAppsFromSingleBucket(
      updatedState.dayBuckets[currentDayBucket]
    )
    const { sampledSeconds } = updatedState
    const confidence =
      sampledSeconds >= HIGH_CONFIDENCE_SECONDS
        ? 'high'
        : sampledSeconds >= MEDIUM_CONFIDENCE_SECONDS
          ? 'medium'
          : 'low'
    const trackingStartedAt = updatedState.trackingStartedAt
      ? DateHelper.getDateTime(updatedState.trackingStartedAt)
      : 'awaiting first sample'

    const summary = `Habits tracking sees ${activeApps.length} running app group(s) now and ${globalTopApps.length} recurring app signal(s), with ${confidence} confidence from ${this.probeHelper.formatUptime(sampledSeconds)} of process monitoring.`

    const globalLines =
      globalTopApps.length > 0
        ? globalTopApps.slice(0, MAX_APP_LINES).map((entry, index) => {
            return `- ${index + 1}. ${entry.appName}: ${this.probeHelper.formatUptime(entry.seconds)}`
          })
        : ['- No stable app habit signals yet']

    const currentWindowLines =
      currentWindowTopApps.length > 0
        ? currentWindowTopApps.slice(0, MAX_BUCKET_LINES).map((entry, index) => {
            return `- ${index + 1}. ${entry.appName}: ${this.probeHelper.formatUptime(entry.seconds)}`
          })
        : ['- No habits for this time window yet']

    const currentDayLines =
      currentDayTopApps.length > 0
        ? currentDayTopApps.slice(0, MAX_BUCKET_LINES).map((entry, index) => {
            return `- ${index + 1}. ${entry.appName}: ${this.probeHelper.formatUptime(entry.seconds)}`
          })
        : ['- No habits for this weekday yet']

    return [
      `> Overall habits, time-window habits, weekday habits. ${summary}`,
      '# HABITS',
      `- Generated at: ${DateHelper.getDateTime()}`,
      `- Tracking started at: ${trackingStartedAt}`,
      `- Current time bucket: ${currentTimeBucket}`,
      `- Current weekday bucket: ${currentDayBucket}`,
      `- Current running app groups: ${activeApps.length}`,
      `- Habits confidence: ${confidence}`,
      '- App durations estimate process presence from periodic snapshots.',
      '## Top App Habits (Overall)',
      ...globalLines,
      `## Top App Habits (${currentTimeBucket})`,
      ...currentWindowLines,
      `## Top App Habits (${currentDayBucket})`,
      ...currentDayLines
    ].join('\n')
  }

  private aggregateActiveApps(entries: RunningProcessEntry[]): string[] {
    return [...new Set(entries.map((entry) => this.normalizeProcessName(entry.name)))]
  }

  private normalizeState(state: HabitsState): HabitsState {
    const hasSampledSeconds = Number.isFinite(state.sampledSeconds) &&
      state.sampledSeconds >= 0

    // Per-app totals include overlapping intervals, so they cannot seed the
    // coverage counter when loading existing habits without one.
    return {
      trackingStartedAt: normalizeSampleTime(state.trackingStartedAt, ''),
      lastSampleAt: hasSampledSeconds ? normalizeSampleTime(state.lastSampleAt, '') : '',
      sampledSeconds: hasSampledSeconds ? state.sampledSeconds : 0,
      timeBuckets: this.normalizeBuckets(state.timeBuckets, EMPTY_TIME_BUCKETS),
      dayBuckets: this.normalizeBuckets(state.dayBuckets, EMPTY_DAY_BUCKETS)
    }
  }

  private updateState(
    state: HabitsState,
    activeApps: string[],
    currentTimeBucket: TimeBucket,
    currentDayBucket: DayBucket,
    now: Date
  ): HabitsState {
    const nowIso = now.toISOString()
    const sampledAt = activeApps.length > 0 ? nowIso : ''
    const deltaSeconds = sampledAt ? this.computeDeltaSeconds(state.lastSampleAt, now) : 0
    const updatedTimeBuckets = { ...state.timeBuckets }
    const updatedDayBuckets = { ...state.dayBuckets }

    if (deltaSeconds > 0) {
      for (const appName of activeApps) {
        updatedTimeBuckets[currentTimeBucket] = {
          ...updatedTimeBuckets[currentTimeBucket],
          [appName]:
            (updatedTimeBuckets[currentTimeBucket]?.[appName] || 0) + deltaSeconds
        }
        updatedDayBuckets[currentDayBucket] = {
          ...updatedDayBuckets[currentDayBucket],
          [appName]: (updatedDayBuckets[currentDayBucket]?.[appName] || 0) + deltaSeconds
        }
      }
    }

    for (const key of Object.keys(updatedTimeBuckets) as TimeBucket[]) {
      updatedTimeBuckets[key] = this.compactBucket(updatedTimeBuckets[key])
    }
    for (const key of Object.keys(updatedDayBuckets) as DayBucket[]) {
      updatedDayBuckets[key] = this.compactBucket(updatedDayBuckets[key])
    }

    return {
      trackingStartedAt: state.trackingStartedAt || sampledAt,
      lastSampleAt: sampledAt,
      sampledSeconds: state.sampledSeconds + deltaSeconds,
      timeBuckets: updatedTimeBuckets,
      dayBuckets: updatedDayBuckets
    }
  }

  private compactBucket(bucket: Record<string, number>): Record<string, number> {
    const compacted = Object.entries(bucket)
      .filter((entry) => Number.isFinite(entry[1]) && entry[1] > 0)
      .sort((entryA, entryB) => entryB[1] - entryA[1])
      .slice(0, MAX_STATE_APPS_PER_BUCKET)
    const result: Record<string, number> = {}

    for (const [appName, seconds] of compacted) {
      result[appName] = seconds
    }

    return result
  }

  private getTopAppsFromBuckets(
    buckets: Record<TimeBucket, Record<string, number>>
  ): Array<{ appName: string, seconds: number }> {
    const totals = new Map<string, number>()

    for (const bucket of Object.values(buckets)) {
      for (const [appName, seconds] of Object.entries(bucket)) {
        totals.set(appName, (totals.get(appName) || 0) + seconds)
      }
    }

    return [...totals.entries()]
      .map(([appName, seconds]) => ({ appName, seconds }))
      .sort((entryA, entryB) => entryB.seconds - entryA.seconds)
  }

  private getTopAppsFromSingleBucket(
    bucket: Record<string, number>
  ): Array<{ appName: string, seconds: number }> {
    return Object.entries(bucket)
      .map(([appName, seconds]) => ({ appName, seconds }))
      .sort((entryA, entryB) => entryB.seconds - entryA.seconds)
  }

  private normalizeBuckets<TBucket extends string>(
    source: Record<TBucket, Record<string, number>> | undefined,
    fallback: Record<TBucket, Record<string, number>>
  ): Record<TBucket, Record<string, number>> {
    const result = {} as Record<TBucket, Record<string, number>>

    for (const key of Object.keys(fallback) as TBucket[]) {
      const candidate = source?.[key]
      result[key] =
        candidate && typeof candidate === 'object' ? { ...candidate } : {}
    }

    return result
  }

  private getTimeBucket(now: Date): TimeBucket {
    const hour = now.getHours()
    if (hour < 6) {
      return 'night'
    }
    if (hour < 12) {
      return 'morning'
    }
    if (hour < 18) {
      return 'afternoon'
    }
    return 'evening'
  }

  private getDayBucket(now: Date): DayBucket {
    const day = now.getDay()
    const mapping: Record<number, DayBucket> = {
      0: 'sunday',
      1: 'monday',
      2: 'tuesday',
      3: 'wednesday',
      4: 'thursday',
      5: 'friday',
      6: 'saturday'
    }

    return mapping[day] || 'monday'
  }

  private computeDeltaSeconds(lastSampleAt: string, now: Date): number {
    const lastTimestamp = Date.parse(lastSampleAt)
    if (!Number.isFinite(lastTimestamp)) {
      return 0
    }

    const rawDelta = Math.floor((now.getTime() - lastTimestamp) / 1_000)
    if (rawDelta <= 0) {
      return 0
    }

    return Math.min(rawDelta, Math.floor((this.ttlMs * 2) / 1_000))
  }

  private normalizeProcessName(rawName: string): string {
    const base = path.basename((rawName || '').trim())
    if (!base) {
      return 'unknown-process'
    }

    return base.replace(/\.exe$/i, '')
  }
}
