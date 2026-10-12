import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { DateHelper } from '@/helpers/date-helper'
import { SystemHelper } from '@/helpers/system-helper'
import { ContextFile } from '@/core/context-manager/context-file'
import {
  ContextProbeHelper,
  RunningProcessEntry
} from '@/core/context-manager/context-probe-helper'
import { ContextStateStore } from '@/core/context-manager/context-state-store'

interface LocalInventoryAppStateEntry {
  observedSeconds: number
  lastSeenAt: string
  seenCount: number
}

interface LocalInventoryState {
  trackingStartedAt: string
  lastSampleAt: string
  apps: Record<string, LocalInventoryAppStateEntry>
}

interface ActiveAppAggregate {
  appName: string
  processCount: number
  totalCpu: number
  cpuMetric: RunningProcessEntry['cpuMetric']
  totalMemoryMb: number
  longestRuntimeSeconds: number
}

interface PeripheralsSnapshot {
  source: string
  keyboards: string[]
  pointers: string[]
  webcams: string[]
  audioInputs: string[]
  audioOutputs: string[]
  defaultAudioInput: string
  defaultAudioOutput: string
}

const MAX_RUNNING_APPS = 32
const MAX_INSTALLED_APPS = 80
const MAX_CATEGORY_LINES = 14
const MAX_PERIPHERAL_ITEMS = 8
const MAX_STATE_APPS = 500
const MAX_SUMMARY_CATEGORIES = 6
const MAX_SUMMARY_APPS_PER_CATEGORY = 3

const FALLBACK_STATE: LocalInventoryState = {
  trackingStartedAt: new Date(0).toISOString(),
  lastSampleAt: new Date(0).toISOString(),
  apps: {}
}

export class LocalInventoryContextFile extends ContextFile {
  public readonly filename = 'LOCAL_INVENTORY.md'
  public readonly ttlMs: number

  private readonly stateStore = new ContextStateStore<LocalInventoryState>(
    '.local-inventory-state.json',
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
    const nowIso = now.toISOString()
    const runningSnapshot = this.probeHelper.probeRunningProcesses(140)
    const activeApps = this.aggregateActiveApps(runningSnapshot.entries)
    const installedApps = this.discoverInstalledApps()
    const peripherals = this.probePeripherals()

    const currentState = this.normalizeState(this.stateStore.load(), nowIso)
    const updatedState = this.updateState(currentState, activeApps, now)
    this.stateStore.save(updatedState)

    const rankedByUsage = this.getAppsRankedByUsage(updatedState.apps)
    const categoryCounts = this.buildCategoryCounts([
      ...installedApps,
      ...activeApps.map((entry) => entry.appName)
    ])
    const installedAppHighlights =
      this.buildInstalledAppHighlights(installedApps)

    const installedAppLines =
      installedApps.length > 0
        ? installedApps.slice(0, MAX_INSTALLED_APPS).map((appName, index) => {
            return `- ${index + 1}. ${appName}`
          })
        : ['- No installed app entries detected']

    const topUsageLines =
      rankedByUsage.length > 0
        ? rankedByUsage.slice(0, MAX_RUNNING_APPS).map((entry, index) => {
            return `- ${index + 1}. ${entry.appName} | observed ${this.probeHelper.formatUptime(entry.observedSeconds)} | last seen ${DateHelper.getDateTime(entry.lastSeenAt) || entry.lastSeenAt} | seen ${entry.seenCount} sample(s)`
          })
        : ['- No usage history collected yet']

    const categoryLines =
      categoryCounts.length > 0
        ? categoryCounts.slice(0, MAX_CATEGORY_LINES).map((entry, index) => {
            return `- ${index + 1}. ${entry.category}: ${entry.count} app(s)`
          })
        : ['- No category signals yet']

    const summary = [
      `Local inventory tracks ${installedApps.length} installed app entry(ies), usage signals across ${rankedByUsage.length} app(s), and peripherals (${peripherals.keyboards.length} keyboard(s), ${peripherals.pointers.length} pointer(s), ${peripherals.webcams.length} webcam(s)).`,
      ...(installedAppHighlights
        ? [`Installed app highlights: ${installedAppHighlights}.`]
        : [])
    ].join(' ')

    return [
      `> Usage-ranked apps, installed apps, categories, peripherals. ${summary}`,
      '# LOCAL_INVENTORY',
      `- Generated at: ${DateHelper.getDateTime()}`,
      `- Usage sample source: ${runningSnapshot.source}`,
      `- Peripherals probe source: ${peripherals.source}`,
      `- Tracking started at: ${DateHelper.getDateTime(updatedState.trackingStartedAt)}`,
      `- Running processes sampled for usage estimation: ${runningSnapshot.entries.length}`,
      `- Installed app entries: ${installedApps.length}`,
      '## Most Used / Recently Seen Apps',
      ...topUsageLines,
      '## Installed Apps Snapshot',
      ...installedAppLines,
      '## App Category Signals',
      ...categoryLines,
      '## Peripherals and I/O',
      `- Keyboards (${peripherals.keyboards.length}): ${this.formatList(peripherals.keyboards, MAX_PERIPHERAL_ITEMS)}`,
      `- Pointers (${peripherals.pointers.length}): ${this.formatList(peripherals.pointers, MAX_PERIPHERAL_ITEMS)}`,
      `- Webcams (${peripherals.webcams.length}): ${this.formatList(peripherals.webcams, MAX_PERIPHERAL_ITEMS)}`,
      `- Audio inputs (${peripherals.audioInputs.length}): ${this.formatList(peripherals.audioInputs, MAX_PERIPHERAL_ITEMS)}`,
      `- Audio outputs (${peripherals.audioOutputs.length}): ${this.formatList(peripherals.audioOutputs, MAX_PERIPHERAL_ITEMS)}`,
      `- Default audio input: ${peripherals.defaultAudioInput}`,
      `- Default audio output: ${peripherals.defaultAudioOutput}`
    ].join('\n')
  }

  private aggregateActiveApps(entries: RunningProcessEntry[]): ActiveAppAggregate[] {
    const aggregateMap = new Map<string, ActiveAppAggregate>()

    for (const entry of entries) {
      const appName = this.normalizeProcessName(entry.name)
      const existing = aggregateMap.get(appName)
      if (!existing) {
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

      existing.processCount += 1
      existing.totalCpu += entry.cpu
      existing.totalMemoryMb += entry.memoryMb
      existing.longestRuntimeSeconds = Math.max(
        existing.longestRuntimeSeconds,
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

  private discoverInstalledApps(): string[] {
    if (SystemHelper.isWindows()) {
      return this.discoverInstalledAppsWindows()
    }

    if (SystemHelper.isMacOS()) {
      return this.discoverInstalledAppsMacOS()
    }

    return this.discoverInstalledAppsLinux()
  }

  private discoverInstalledAppsLinux(): string[] {
    const desktopFiles: string[] = []
    const roots = [
      '/usr/share/applications',
      '/var/lib/flatpak/exports/share/applications',
      path.join(os.homedir(), '.local', 'share', 'applications')
    ]

    for (const root of roots) {
      if (!fs.existsSync(root)) {
        continue
      }

      try {
        const entries = fs.readdirSync(root)
        for (const entry of entries) {
          if (!entry.endsWith('.desktop')) {
            continue
          }
          desktopFiles.push(path.join(root, entry))
        }
      } catch {
        continue
      }
    }

    const names = new Set<string>()

    for (const desktopFile of desktopFiles.slice(0, 1200)) {
      try {
        const content = fs.readFileSync(desktopFile, 'utf8')
        const noDisplayLine = content
          .split('\n')
          .find((line) => line.startsWith('NoDisplay='))
        if (noDisplayLine?.toLowerCase().includes('true')) {
          continue
        }

        const nameLine = content
          .split('\n')
          .find((line) => line.startsWith('Name='))
        const value = nameLine?.slice(5).trim() || ''
        if (value) {
          names.add(value)
        }
      } catch {
        continue
      }
    }

    return [...names].sort((nameA, nameB) => nameA.localeCompare(nameB))
  }

  private discoverInstalledAppsMacOS(): string[] {
    const roots = ['/Applications', path.join(os.homedir(), 'Applications')]
    const names = new Set<string>()

    for (const root of roots) {
      if (!fs.existsSync(root)) {
        continue
      }

      try {
        const entries = fs.readdirSync(root, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isDirectory() || !entry.name.endsWith('.app')) {
            continue
          }

          names.add(entry.name.replace(/\.app$/i, '').trim())
        }
      } catch {
        continue
      }
    }

    return [...names].sort((nameA, nameB) => nameA.localeCompare(nameB))
  }

  private discoverInstalledAppsWindows(): string[] {
    const raw = this.probeHelper.runCommand('powershell', [
      '-NoProfile',
      '-Command',
      '(Get-StartApps | Select-Object Name | ConvertTo-Json -Compress)'
    ])
    if (!raw) {
      return []
    }

    try {
      const parsed = JSON.parse(raw) as
        | {
            Name?: string
          }
        | Array<{
            Name?: string
          }>

      const rows = Array.isArray(parsed) ? parsed : [parsed]
      const names = new Set(
        rows
          .map((row) => (row.Name || '').trim())
          .filter((name) => name.length > 0)
      )

      return [...names].sort((nameA, nameB) => nameA.localeCompare(nameB))
    } catch {
      return []
    }
  }

  private probePeripherals(): PeripheralsSnapshot {
    if (SystemHelper.isWindows()) {
      return this.probePeripheralsWindows()
    }

    if (SystemHelper.isMacOS()) {
      return this.probePeripheralsMacOS()
    }

    return this.probePeripheralsLinux()
  }

  private probePeripheralsLinux(): PeripheralsSnapshot {
    const base: PeripheralsSnapshot = {
      source: 'linux_input_and_audio',
      keyboards: [],
      pointers: [],
      webcams: [],
      audioInputs: [],
      audioOutputs: [],
      defaultAudioInput: 'unknown',
      defaultAudioOutput: 'unknown'
    }

    const devicesFile = '/proc/bus/input/devices'
    if (fs.existsSync(devicesFile)) {
      try {
        const content = fs.readFileSync(devicesFile, 'utf8')
        const blocks = content.split('\n\n')
        for (const block of blocks) {
          const nameLine = block
            .split('\n')
            .find((line) => line.startsWith('N: Name='))
          const name = nameLine?.split('=').at(-1)?.replace(/^"|"$/g, '') || ''
          const handlersLine = block
            .split('\n')
            .find((line) => line.startsWith('H: Handlers='))
          const handlers = handlersLine?.toLowerCase() || ''

          if (name && handlers.includes('kbd')) {
            base.keyboards.push(name)
          }

          if (name && (handlers.includes('mouse') || handlers.includes('event'))) {
            if (/(mouse|touchpad|trackpoint|pointer)/i.test(name)) {
              base.pointers.push(name)
            }
          }
        }
      } catch {
        // Ignore parsing failures.
      }
    }

    try {
      base.webcams = fs
        .readdirSync('/dev')
        .filter((entry) => entry.startsWith('video'))
        .map((entry) => `/dev/${entry}`)
    } catch {
      // Ignore webcam discovery failures.
    }

    const pactlInfo = this.probeHelper.runCommand('pactl', ['info']) || ''
    const defaultSink = pactlInfo.match(/Default Sink:\s*(.+)/)?.[1]?.trim()
    const defaultSource = pactlInfo.match(/Default Source:\s*(.+)/)?.[1]?.trim()
    if (defaultSink) {
      base.defaultAudioOutput = defaultSink
    }
    if (defaultSource) {
      base.defaultAudioInput = defaultSource
    }

    const sinks = this.probeHelper.runCommand('pactl', ['list', 'short', 'sinks']) || ''
    const sources =
      this.probeHelper.runCommand('pactl', ['list', 'short', 'sources']) || ''
    base.audioOutputs = sinks
      .split('\n')
      .map((line) => line.trim().split('\t')[1] || '')
      .filter((line) => line.length > 0)
    base.audioInputs = sources
      .split('\n')
      .map((line) => line.trim().split('\t')[1] || '')
      .filter((line) => line.length > 0)

    return this.normalizePeripherals(base)
  }

  private probePeripheralsMacOS(): PeripheralsSnapshot {
    const snapshot: PeripheralsSnapshot = {
      source: 'system_profiler',
      keyboards: [],
      pointers: [],
      webcams: [],
      audioInputs: [],
      audioOutputs: [],
      defaultAudioInput: 'unknown',
      defaultAudioOutput: 'unknown'
    }

    const usb = this.probeHelper.runCommand('system_profiler', ['SPUSBDataType']) || ''
    for (const line of usb.split('\n').map((row) => row.trim())) {
      if (/keyboard/i.test(line)) {
        snapshot.keyboards.push(line.replace(/:$/, ''))
      }
      if (/(mouse|trackpad|pointer)/i.test(line)) {
        snapshot.pointers.push(line.replace(/:$/, ''))
      }
    }

    const cameras =
      this.probeHelper.runCommand('system_profiler', ['SPCameraDataType']) || ''
    for (const line of cameras.split('\n').map((row) => row.trim())) {
      if (!line || line.endsWith(':') === false) {
        continue
      }
      if (/camera|facetime|webcam|video/i.test(line)) {
        snapshot.webcams.push(line.replace(/:$/, ''))
      }
    }

    const audio =
      this.probeHelper.runCommand('system_profiler', ['SPAudioDataType']) || ''
    for (const line of audio.split('\n').map((row) => row.trim())) {
      if (!line || !line.endsWith(':')) {
        continue
      }

      const item = line.replace(/:$/, '')
      if (/output/i.test(item)) {
        snapshot.audioOutputs.push(item)
      } else if (/input/i.test(item)) {
        snapshot.audioInputs.push(item)
      }
    }

    return this.normalizePeripherals(snapshot)
  }

  private probePeripheralsWindows(): PeripheralsSnapshot {
    const script = `
$devices = Get-PnpDevice | Where-Object { $_.Status -eq 'OK' -and ($_.Class -in @('Keyboard','Mouse','Image','AudioEndpoint')) } | Select-Object Class,FriendlyName
$audio = Get-CimInstance Win32_SoundDevice | Select-Object Name
[PSCustomObject]@{
  devices = $devices
  audio = $audio
} | ConvertTo-Json -Compress
    `.trim()

    const raw = this.probeHelper.runCommand('powershell', [
      '-NoProfile',
      '-Command',
      script
    ])

    const snapshot: PeripheralsSnapshot = {
      source: 'powershell_get_pnpdevice',
      keyboards: [],
      pointers: [],
      webcams: [],
      audioInputs: [],
      audioOutputs: [],
      defaultAudioInput: 'unknown',
      defaultAudioOutput: 'unknown'
    }

    if (!raw) {
      return snapshot
    }

    try {
      const parsed = JSON.parse(raw) as {
        devices?: Array<{
          Class?: string
          FriendlyName?: string
        }>
        audio?: Array<{
          Name?: string
        }>
      }

      const devices = Array.isArray(parsed.devices)
        ? parsed.devices
        : parsed.devices
          ? [parsed.devices as unknown as { Class?: string, FriendlyName?: string }]
          : []

      for (const device of devices) {
        const className = (device.Class || '').toLowerCase()
        const name = (device.FriendlyName || '').trim()
        if (!name) {
          continue
        }

        if (className === 'keyboard') {
          snapshot.keyboards.push(name)
        } else if (className === 'mouse') {
          snapshot.pointers.push(name)
        } else if (className === 'image') {
          snapshot.webcams.push(name)
        } else if (className === 'audioendpoint') {
          snapshot.audioOutputs.push(name)
        }
      }

      const audioRows = Array.isArray(parsed.audio)
        ? parsed.audio
        : parsed.audio
          ? [parsed.audio as unknown as { Name?: string }]
          : []
      for (const row of audioRows) {
        const name = (row.Name || '').trim()
        if (name) {
          snapshot.audioOutputs.push(name)
        }
      }
    } catch {
      return snapshot
    }

    return this.normalizePeripherals(snapshot)
  }

  private normalizePeripherals(snapshot: PeripheralsSnapshot): PeripheralsSnapshot {
    const unique = (values: string[]): string[] =>
      [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))]
    const normalized = {
      ...snapshot,
      keyboards: unique(snapshot.keyboards),
      pointers: unique(snapshot.pointers),
      webcams: unique(snapshot.webcams),
      audioInputs: unique(snapshot.audioInputs),
      audioOutputs: unique(snapshot.audioOutputs)
    }

    if (normalized.defaultAudioInput === 'unknown' && normalized.audioInputs[0]) {
      normalized.defaultAudioInput = normalized.audioInputs[0]
    }

    if (normalized.defaultAudioOutput === 'unknown' && normalized.audioOutputs[0]) {
      normalized.defaultAudioOutput = normalized.audioOutputs[0]
    }

    return normalized
  }

  private normalizeState(state: LocalInventoryState, nowIso: string): LocalInventoryState {
    const trackingStartedAt = this.isIsoDate(state.trackingStartedAt)
      ? state.trackingStartedAt
      : nowIso
    const lastSampleAt = this.isIsoDate(state.lastSampleAt) ? state.lastSampleAt : nowIso

    return {
      trackingStartedAt,
      lastSampleAt,
      apps: state.apps && typeof state.apps === 'object' ? state.apps : {}
    }
  }

  private updateState(
    state: LocalInventoryState,
    activeApps: ActiveAppAggregate[],
    now: Date
  ): LocalInventoryState {
    const nowIso = now.toISOString()
    const deltaSeconds = this.computeDeltaSeconds(state.lastSampleAt, now)
    const apps = { ...state.apps }

    if (deltaSeconds > 0) {
      for (const app of activeApps) {
        const current = apps[app.appName] || {
          observedSeconds: 0,
          lastSeenAt: nowIso,
          seenCount: 0
        }

        apps[app.appName] = {
          observedSeconds: current.observedSeconds + deltaSeconds,
          lastSeenAt: nowIso,
          seenCount: current.seenCount + 1
        }
      }
    }

    const compactedEntries = Object.entries(apps)
      .sort((entryA, entryB) => {
        const secondsDiff = (entryB[1]?.observedSeconds || 0) - (entryA[1]?.observedSeconds || 0)
        if (secondsDiff !== 0) {
          return secondsDiff
        }

        const seenDiff = Date.parse(entryB[1]?.lastSeenAt || '') - Date.parse(entryA[1]?.lastSeenAt || '')
        return Number.isFinite(seenDiff) ? seenDiff : 0
      })
      .slice(0, MAX_STATE_APPS)
    const compactedApps: Record<string, LocalInventoryAppStateEntry> = {}

    for (const [appName, entry] of compactedEntries) {
      compactedApps[appName] = entry
    }

    return {
      trackingStartedAt: state.trackingStartedAt,
      lastSampleAt: nowIso,
      apps: compactedApps
    }
  }

  private getAppsRankedByUsage(
    apps: Record<string, LocalInventoryAppStateEntry>
  ): Array<{
    appName: string
    observedSeconds: number
    lastSeenAt: string
    seenCount: number
  }> {
    return Object.entries(apps)
      .map(([appName, entry]) => ({
        appName,
        observedSeconds: Number(entry?.observedSeconds || 0),
        lastSeenAt: entry?.lastSeenAt || 'unknown',
        seenCount: Number(entry?.seenCount || 0)
      }))
      .filter((entry) => entry.observedSeconds > 0 || entry.seenCount > 0)
      .sort((entryA, entryB) => {
        if (entryA.observedSeconds !== entryB.observedSeconds) {
          return entryB.observedSeconds - entryA.observedSeconds
        }

        return Date.parse(entryB.lastSeenAt) - Date.parse(entryA.lastSeenAt)
      })
  }

  private buildCategoryCounts(appNames: string[]): Array<{ category: string, count: number }> {
    const categoryMap = new Map<string, number>()

    for (const appName of appNames) {
      const category = this.detectCategory(appName)
      categoryMap.set(category, (categoryMap.get(category) || 0) + 1)
    }

    return [...categoryMap.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((entryA, entryB) => entryB.count - entryA.count)
  }

  private buildInstalledAppHighlights(appNames: string[]): string {
    const appsByCategory = new Map<string, string[]>()

    for (const appName of appNames) {
      const category = this.detectCategory(appName)
      if (category === 'other') {
        continue
      }

      const categoryApps = appsByCategory.get(category) || []
      if (categoryApps.length < MAX_SUMMARY_APPS_PER_CATEGORY) {
        categoryApps.push(appName)
        appsByCategory.set(category, categoryApps)
      }
    }

    return [...appsByCategory.entries()]
      .sort(([categoryA], [categoryB]) => categoryA.localeCompare(categoryB))
      .slice(0, MAX_SUMMARY_CATEGORIES)
      .map(([category, apps]) => `${category}: ${apps.join(', ')}`)
      .join('; ')
  }

  private detectCategory(appName: string): string {
    const normalized = appName.toLowerCase()
    if (/(slack|discord|wechat|telegram|teams|whatsapp)/.test(normalized)) {
      return 'messaging'
    }
    if (/(code|intellij|idea|pycharm|webstorm|vim|nvim|cursor|zed)/.test(normalized)) {
      return 'development'
    }
    if (/(brave|chrome|firefox|edge|safari|chromium)/.test(normalized)) {
      return 'browser'
    }
    if (/(spotify|music|vlc|mpv|yt|youtube|netflix|plex)/.test(normalized)) {
      return 'media'
    }
    if (/(terminal|shell|powershell|bash|zsh|cmd|ghostty|iterm)/.test(normalized)) {
      return 'terminal'
    }

    return 'other'
  }

  private computeDeltaSeconds(lastSampleAt: string, now: Date): number {
    const lastTimestamp = Date.parse(lastSampleAt)
    if (!Number.isFinite(lastTimestamp)) {
      return 0
    }

    const rawDelta = Math.floor((now.getTime() - lastTimestamp) / 1000)
    if (rawDelta <= 0) {
      return 0
    }

    return Math.min(rawDelta, Math.floor((this.ttlMs * 2) / 1000))
  }

  private isIsoDate(value: string): boolean {
    if (!value) {
      return false
    }

    return Number.isFinite(Date.parse(value))
  }

  private normalizeProcessName(rawName: string): string {
    const base = path.basename((rawName || '').trim())
    if (!base) {
      return 'unknown-process'
    }

    return base.replace(/\.exe$/i, '')
  }

  private formatList(values: string[], maxItems: number): string {
    if (values.length === 0) {
      return 'none'
    }

    const displayed = values.slice(0, maxItems)
    const suffix =
      values.length > maxItems ? ` (+${values.length - maxItems} more)` : ''
    return `${displayed.join(', ')}${suffix}`
  }
}
