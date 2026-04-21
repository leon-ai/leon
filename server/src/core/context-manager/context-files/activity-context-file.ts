import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { PROFILE_CONTEXT_PATH } from '@/constants'
import { DateHelper } from '@/helpers/date-helper'
import { SystemHelper } from '@/helpers/system-helper'
import { ContextFile } from '@/core/context-manager/context-file'
import {
  ContextProbeHelper,
  RunningProcessEntry
} from '@/core/context-manager/context-probe-helper'

interface AppActivityAggregate {
  appName: string
  processCount: number
  totalCpu: number
  cpuMetric: RunningProcessEntry['cpuMetric']
  totalMemoryMb: number
  longestRuntimeSeconds: number
}

interface ActivityLogFileEntry {
  appHint: string
  filePath: string
  modifiedAt: string
  sizeBytes: number
}

interface ActivityTrackingState {
  trackingStartedAt: string
  lastSampleAt: string
  observedSecondsByApp: Record<string, number>
}

const MAX_PROCESS_ENTRIES = 96
const MAX_APP_LINES = 16
const MAX_LOG_LINES = 20
const MAX_LOG_LINES_PER_APP = 2
const MAX_OBSERVED_APP_LINES = 16
const MAX_LOG_DIR_DEPTH = 3
const MAX_LOG_DIRECTORIES_SCANNED = 600
const MAX_LOG_CANDIDATE_FILES = 2_400
const MAX_WINDOWS_ROOT_CHILDREN = 140
const ACTIVITY_STATE_FILENAME = '.activity-state.json'
const MAX_ACTIVITY_STATE_APP_ENTRIES = 256

export class ActivityContextFile extends ContextFile {
  public readonly filename = 'ACTIVITY.md'
  public readonly ttlMs: number

  public constructor(
    private readonly probeHelper: ContextProbeHelper,
    ttlMs: number
  ) {
    super()
    this.ttlMs = ttlMs
  }

  public generate(): string {
    const now = new Date()
    const processSnapshot = this.probeHelper.probeRunningProcesses(MAX_PROCESS_ENTRIES)
    const appActivity = this.aggregateAppActivity(processSnapshot.entries)
    const recentLogFiles = this.probeRecentAppLogs(appActivity.map((entry) => entry.appName))
    const previousTrackingState = this.loadTrackingState()
    const updatedTrackingState = this.updateTrackingState(
      previousTrackingState,
      appActivity,
      now
    )
    this.saveTrackingState(updatedTrackingState)

    const observedAppLines = this.formatObservedAppLines(
      updatedTrackingState.observedSecondsByApp
    )

    const summary =
      appActivity.length > 0
        ? `Machine activity snapshot found ${appActivity.length} active app group(s) from ${processSnapshot.entries.length} running process sample(s), top app "${appActivity[0]?.appName || 'unknown'}", and ${recentLogFiles.length} recent app log file(s).`
        : `Machine activity snapshot unavailable: no running process samples available from ${processSnapshot.source}.`

    const appLines =
      appActivity.length > 0
        ? appActivity.slice(0, MAX_APP_LINES).map((entry, index) => {
            return `- ${index + 1}. ${entry.appName} | processes: ${entry.processCount} | runtime up to ${this.probeHelper.formatUptime(entry.longestRuntimeSeconds)} | RAM: ${entry.totalMemoryMb.toFixed(1)} MB | CPU: ${this.formatCpu(entry.totalCpu, entry.cpuMetric)}`
          })
        : ['- No active app groups available']

    const logLines =
      recentLogFiles.length > 0
        ? recentLogFiles.slice(0, MAX_LOG_LINES).map((entry, index) => {
            return `- ${index + 1}. ${this.formatDateTime(entry.modifiedAt)} | ${entry.appHint} | ${entry.filePath} | ${entry.sizeBytes} B`
          })
        : ['- No recent app log files detected in common user log locations']

    return [
      `> Active apps, observed app time, recent app logs. ${summary}`,
      '# ACTIVITY',
      `- Generated at: ${DateHelper.getDateTime()}`,
      `- Process probe source: ${processSnapshot.source}`,
      `- Process sample time: ${this.formatDateTime(processSnapshot.sampledAt)}`,
      `- Running processes sampled: ${processSnapshot.entries.length}`,
      `- Active app groups: ${appActivity.length}`,
      `- Boot time: ${DateHelper.getDateTime(Date.now() - os.uptime() * 1_000)}`,
      `- Uptime: ${this.probeHelper.formatUptime(os.uptime())}`,
      '- Note: this is a running-process snapshot, not a foreground-window tracker.',
      '- Note: observed app time below is cumulative from periodic snapshots.',
      '## Active Apps',
      ...appLines,
      '## Observed App Time',
      `- Tracking started at: ${this.formatDateTime(updatedTrackingState.trackingStartedAt)}`,
      ...observedAppLines,
      '## Recent App Logs',
      ...logLines
    ].join('\n')
  }

  private formatDateTime(value: string | number | Date): string {
    return DateHelper.getDateTime(value) || String(value || 'unknown')
  }

  private aggregateAppActivity(
    entries: RunningProcessEntry[]
  ): AppActivityAggregate[] {
    const aggregateMap = new Map<string, AppActivityAggregate>()

    for (const entry of entries) {
      const appName = this.normalizeProcessName(entry.name)
      const currentAggregate = aggregateMap.get(appName)

      if (!currentAggregate) {
        aggregateMap.set(appName, {
          appName,
          processCount: 1,
          totalCpu: entry.cpu,
          cpuMetric: entry.cpuMetric,
          totalMemoryMb: entry.memoryMb,
          longestRuntimeSeconds: entry.runtimeSeconds
        })
        continue
      }

      currentAggregate.processCount += 1
      currentAggregate.totalCpu += entry.cpu
      currentAggregate.totalMemoryMb += entry.memoryMb
      currentAggregate.longestRuntimeSeconds = Math.max(
        currentAggregate.longestRuntimeSeconds,
        entry.runtimeSeconds
      )
    }

    return [...aggregateMap.values()].sort((entryA, entryB) => {
      if (entryA.totalCpu !== entryB.totalCpu) {
        return entryB.totalCpu - entryA.totalCpu
      }

      if (entryA.totalMemoryMb !== entryB.totalMemoryMb) {
        return entryB.totalMemoryMb - entryA.totalMemoryMb
      }

      return entryB.longestRuntimeSeconds - entryA.longestRuntimeSeconds
    })
  }

  private probeRecentAppLogs(appNames: string[]): ActivityLogFileEntry[] {
    const normalizedTerms = [...new Set(appNames.map((name) => name.toLowerCase()))]
      .filter((name) => name.length >= 3)
      .slice(0, 24)
    const candidateRoots = this.getCandidateLogRoots()
    const queue = candidateRoots
      .filter((rootPath) => fs.existsSync(rootPath))
      .map((rootPath) => ({ directory: rootPath, depth: 0 }))
    const discoveredFiles: ActivityLogFileEntry[] = []

    let scannedDirectoriesCount = 0
    let discoveredCandidateFilesCount = 0

    while (queue.length > 0) {
      if (
        scannedDirectoriesCount >= MAX_LOG_DIRECTORIES_SCANNED ||
        discoveredCandidateFilesCount >= MAX_LOG_CANDIDATE_FILES
      ) {
        break
      }

      const current = queue.shift()
      if (!current) {
        break
      }

      scannedDirectoriesCount += 1

      let children: fs.Dirent[] = []
      try {
        children = fs.readdirSync(current.directory, { withFileTypes: true })
      } catch {
        continue
      }

      for (const child of children) {
        const childPath = path.join(current.directory, child.name)

        if (child.isDirectory()) {
          if (current.depth >= MAX_LOG_DIR_DEPTH) {
            continue
          }

          if (this.shouldSkipLogDirectory(child.name)) {
            continue
          }

          queue.push({
            directory: childPath,
            depth: current.depth + 1
          })
          continue
        }

        if (!child.isFile() || !this.isLikelyLogFileName(child.name)) {
          continue
        }

        discoveredCandidateFilesCount += 1

        const normalizedPath = childPath.toLowerCase()
        if (
          normalizedTerms.length > 0 &&
          !normalizedTerms.some((term) => normalizedPath.includes(term))
        ) {
          continue
        }

        try {
          const stat = fs.statSync(childPath)
          discoveredFiles.push({
            appHint: this.inferAppHint(childPath, normalizedTerms),
            filePath: childPath,
            modifiedAt: stat.mtime.toISOString(),
            sizeBytes: stat.size
          })
        } catch {
          continue
        }
      }
    }

    const sortedEntries = discoveredFiles
      .sort((entryA, entryB) => {
        if (entryA.modifiedAt < entryB.modifiedAt) {
          return 1
        }

        if (entryA.modifiedAt > entryB.modifiedAt) {
          return -1
        }

        return entryB.sizeBytes - entryA.sizeBytes
      })

    return this.balanceRecentLogEntries(sortedEntries)
  }

  private getCandidateLogRoots(): string[] {
    const homeDirectory = os.homedir()

    if (SystemHelper.isWindows()) {
      const localAppData =
        process.env['LOCALAPPDATA'] || path.join(homeDirectory, 'AppData', 'Local')
      const appData =
        process.env['APPDATA'] || path.join(homeDirectory, 'AppData', 'Roaming')

      return [
        path.join(localAppData, 'Temp'),
        ...this.discoverNestedLogRoots(localAppData),
        ...this.discoverNestedLogRoots(appData)
      ]
    }

    if (SystemHelper.isMacOS()) {
      const libraryPath = path.join(homeDirectory, 'Library')

      return [
        path.join(libraryPath, 'Logs'),
        ...this.discoverNestedLogRoots(path.join(libraryPath, 'Application Support'))
      ]
    }

    return [
      path.join(homeDirectory, '.local', 'state'),
      path.join(homeDirectory, '.cache'),
      ...this.discoverNestedLogRoots(path.join(homeDirectory, '.config'))
    ]
  }

  private discoverNestedLogRoots(baseDirectory: string): string[] {
    if (!fs.existsSync(baseDirectory)) {
      return []
    }

    let firstLevelEntries: fs.Dirent[] = []
    try {
      firstLevelEntries = fs.readdirSync(baseDirectory, { withFileTypes: true })
    } catch {
      return []
    }

    const roots: string[] = []

    for (const entry of firstLevelEntries.slice(0, MAX_WINDOWS_ROOT_CHILDREN)) {
      if (!entry.isDirectory()) {
        continue
      }

      const directLogsPath = path.join(baseDirectory, entry.name)
      if (this.isLikelyLogDirectoryName(entry.name)) {
        roots.push(directLogsPath)
      }

      const nestedNames = ['logs', 'Logs', 'log', 'Log']
      for (const nestedName of nestedNames) {
        const nestedPath = path.join(directLogsPath, nestedName)
        if (fs.existsSync(nestedPath)) {
          roots.push(nestedPath)
        }
      }
    }

    return roots
  }

  private shouldSkipLogDirectory(directoryName: string): boolean {
    const normalizedName = directoryName.toLowerCase()
    const skippedDirectoryNames = new Set([
      'cache',
      'caches',
      'code cache',
      'gpucache',
      'service worker',
      'blob_storage',
      'shadercache',
      'tmp',
      'temp'
    ])

    return skippedDirectoryNames.has(normalizedName)
  }

  private isLikelyLogDirectoryName(directoryName: string): boolean {
    const normalizedName = directoryName.toLowerCase()

    return (
      normalizedName === 'logs' ||
      normalizedName === 'log' ||
      normalizedName.endsWith('-logs') ||
      normalizedName.endsWith('_logs')
    )
  }

  private isLikelyLogFileName(fileName: string): boolean {
    const normalizedName = fileName.toLowerCase()

    return (
      normalizedName.includes('log') ||
      normalizedName.endsWith('.txt') ||
      normalizedName.endsWith('.out') ||
      normalizedName.endsWith('.err') ||
      normalizedName.endsWith('.jsonl')
    )
  }

  private inferAppHint(filePath: string, appTerms: string[]): string {
    const normalizedPath = filePath.toLowerCase()
    const matchedTerm = appTerms.find((term) => normalizedPath.includes(term))
    if (matchedTerm) {
      return this.normalizeAppHint(matchedTerm)
    }

    return this.normalizeAppHint(path.basename(path.dirname(filePath)) || 'unknown-app')
  }

  private normalizeAppHint(rawAppHint: string): string {
    const normalized = rawAppHint.toLowerCase()

    if (/(jetbrains|intellij|idea|pycharm|webstorm|goland|clion|rubymine)/.test(normalized)) {
      return 'jetbrains-ide'
    }

    if (/(vscode|code)/.test(normalized)) {
      return 'vscode'
    }

    if (/chrome/.test(normalized)) {
      return 'chrome'
    }

    if (/brave/.test(normalized)) {
      return 'brave'
    }

    if (/firefox/.test(normalized)) {
      return 'firefox'
    }

    return normalized
  }

  private balanceRecentLogEntries(entries: ActivityLogFileEntry[]): ActivityLogFileEntry[] {
    const appHintCounts = new Map<string, number>()
    const selectedEntries: ActivityLogFileEntry[] = []

    for (const entry of entries) {
      const key = entry.appHint || 'unknown-app'
      const currentCount = appHintCounts.get(key) || 0
      if (currentCount >= MAX_LOG_LINES_PER_APP) {
        continue
      }

      selectedEntries.push(entry)
      appHintCounts.set(key, currentCount + 1)

      if (selectedEntries.length >= MAX_LOG_LINES) {
        break
      }
    }

    if (selectedEntries.length > 0) {
      return selectedEntries
    }

    return entries.slice(0, MAX_LOG_LINES)
  }

  private normalizeProcessName(rawProcessName: string): string {
    const baseName = path.basename((rawProcessName || '').trim())
    if (!baseName) {
      return 'unknown-process'
    }

    return baseName.replace(/\.exe$/i, '')
  }

  private formatCpu(value: number, metric: RunningProcessEntry['cpuMetric']): string {
    if (!Number.isFinite(value)) {
      return 'unknown'
    }

    if (metric === 'seconds') {
      return `${value.toFixed(1)}s`
    }

    return `${value.toFixed(1)}%`
  }

  private loadTrackingState(): ActivityTrackingState {
    const stateFilePath = this.getStateFilePath()
    if (!fs.existsSync(stateFilePath)) {
      const nowIso = new Date().toISOString()
      return {
        trackingStartedAt: nowIso,
        lastSampleAt: nowIso,
        observedSecondsByApp: {}
      }
    }

    try {
      const rawContent = fs.readFileSync(stateFilePath, 'utf8')
      const parsedState = JSON.parse(rawContent) as ActivityTrackingState

      if (
        !parsedState ||
        typeof parsedState.trackingStartedAt !== 'string' ||
        typeof parsedState.lastSampleAt !== 'string' ||
        typeof parsedState.observedSecondsByApp !== 'object' ||
        !parsedState.observedSecondsByApp
      ) {
        throw new Error('invalid_activity_state')
      }

      return parsedState
    } catch {
      const nowIso = new Date().toISOString()
      return {
        trackingStartedAt: nowIso,
        lastSampleAt: nowIso,
        observedSecondsByApp: {}
      }
    }
  }

  private updateTrackingState(
    currentState: ActivityTrackingState,
    appActivity: AppActivityAggregate[],
    now: Date
  ): ActivityTrackingState {
    const observedSecondsByApp = { ...currentState.observedSecondsByApp }
    const deltaSeconds = this.computeStateDeltaSeconds(currentState.lastSampleAt, now)

    if (deltaSeconds > 0) {
      for (const app of appActivity) {
        observedSecondsByApp[app.appName] =
          (observedSecondsByApp[app.appName] || 0) + deltaSeconds
      }
    }

    const compactedEntries = Object.entries(observedSecondsByApp)
      .filter((entry) => Number.isFinite(entry[1]) && entry[1] > 0)
      .sort((entryA, entryB) => entryB[1] - entryA[1])
      .slice(0, MAX_ACTIVITY_STATE_APP_ENTRIES)
    const compactedObservedSecondsByApp: Record<string, number> = {}

    for (const [appName, observedSeconds] of compactedEntries) {
      compactedObservedSecondsByApp[appName] = observedSeconds
    }

    return {
      trackingStartedAt: currentState.trackingStartedAt || now.toISOString(),
      lastSampleAt: now.toISOString(),
      observedSecondsByApp: compactedObservedSecondsByApp
    }
  }

  private saveTrackingState(state: ActivityTrackingState): void {
    const stateFilePath = this.getStateFilePath()

    try {
      fs.mkdirSync(PROFILE_CONTEXT_PATH, { recursive: true })
      fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2), 'utf8')
    } catch {
      // Ignore state persistence errors.
    }
  }

  private formatObservedAppLines(
    observedSecondsByApp: Record<string, number>
  ): string[] {
    const entries = Object.entries(observedSecondsByApp)
      .filter((entry) => Number.isFinite(entry[1]) && entry[1] > 0)
      .sort((entryA, entryB) => entryB[1] - entryA[1])
      .slice(0, MAX_OBSERVED_APP_LINES)

    if (entries.length === 0) {
      return ['- No observed app-time samples collected yet']
    }

    return entries.map(([appName, seconds], index) => {
      return `- ${index + 1}. ${appName} | observed ${this.probeHelper.formatUptime(seconds)}`
    })
  }

  private computeStateDeltaSeconds(previousSampleAt: string, now: Date): number {
    const previousSampleTimestamp = Date.parse(previousSampleAt)
    if (!Number.isFinite(previousSampleTimestamp)) {
      return 0
    }

    const deltaSeconds = Math.floor((now.getTime() - previousSampleTimestamp) / 1_000)
    if (deltaSeconds <= 0) {
      return 0
    }

    const maxDeltaSeconds = Math.floor((this.ttlMs * 2) / 1_000)
    return Math.min(deltaSeconds, maxDeltaSeconds)
  }

  private getStateFilePath(): string {
    return path.join(PROFILE_CONTEXT_PATH, ACTIVITY_STATE_FILENAME)
  }
}
