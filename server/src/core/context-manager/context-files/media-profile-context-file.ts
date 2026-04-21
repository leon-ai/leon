import fs from 'node:fs'
import path from 'node:path'

import { PROFILE_CONTEXT_PATH } from '@/constants'
import { DateHelper } from '@/helpers/date-helper'
import { ContextFile } from '@/core/context-manager/context-file'
import { ContextProbeHelper } from '@/core/context-manager/context-probe-helper'
import { ContextStateStore } from '@/core/context-manager/context-state-store'

interface MediaProfileState {
  trackingStartedAt: string
  lastSampleAt: string
  seenEntries: Record<string, string>
  domains: Record<string, number>
}

interface BrowserHistoryRecord {
  timestamp: string
  domain: string
  title: string
}

const FALLBACK_STATE: MediaProfileState = {
  trackingStartedAt: new Date(0).toISOString(),
  lastSampleAt: new Date(0).toISOString(),
  seenEntries: {},
  domains: {}
}

const MAX_DOMAINS = 24
const MAX_SEEN_ENTRIES = 4000

export class MediaProfileContextFile extends ContextFile {
  public readonly filename = 'MEDIA_PROFILE.md'
  public readonly ttlMs: number

  private readonly stateStore = new ContextStateStore<MediaProfileState>(
    '.media-profile-state.json',
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
    const nowIso = new Date().toISOString()
    const browserHistoryPath = path.join(
      PROFILE_CONTEXT_PATH,
      'BROWSER_HISTORY.md'
    )
    const browserRecords = this.loadBrowserHistoryRecords(browserHistoryPath)
    const runningApps = this.probeHelper
      .probeRunningProcesses(90)
      .entries.map((entry) => entry.name.toLowerCase())

    const state = this.normalizeState(this.stateStore.load(), nowIso)
    const updatedState = this.updateState(state, browserRecords, nowIso)
    this.stateStore.save(updatedState)

    const topDomains = this.rankCounts(updatedState.domains).slice(0, MAX_DOMAINS)
    const mediaSignals = this.buildMediaSignals(runningApps, topDomains.map((entry) => entry.key))

    const summary =
      topDomains.length > 0
        ? `Media profile tracks ${topDomains.length} recurring domain signal(s) from local browsing patterns and runtime app signals.`
        : 'Media profile is not available yet because no local media browsing signals were found.'

    const domainLines =
      topDomains.length > 0
        ? topDomains.map(
            (entry, index) => `- ${index + 1}. ${entry.key}: ${entry.value} hit(s)`
          )
        : ['- No domain profile signals yet']

    const signalLines =
      mediaSignals.length > 0
        ? mediaSignals.map((line, index) => `- ${index + 1}. ${line}`)
        : ['- No strong app/platform media signals yet']

    return [
      `> Top media domains and app/platform signals. ${summary}`,
      '# MEDIA_PROFILE',
      `- Generated at: ${DateHelper.getDateTime()}`,
      `- Tracking started at: ${DateHelper.getDateTime(updatedState.trackingStartedAt)}`,
      `- Browser records parsed this run: ${browserRecords.length}`,
      `- Domain signals stored: ${Object.keys(updatedState.domains).length}`,
      '## Top Media Domains',
      ...domainLines,
      '## App and Platform Signals',
      ...signalLines
    ].join('\n')
  }

  private loadBrowserHistoryRecords(browserHistoryPath: string): BrowserHistoryRecord[] {
    if (!fs.existsSync(browserHistoryPath)) {
      return []
    }

    try {
      const raw = fs.readFileSync(browserHistoryPath, 'utf8')
      const records: BrowserHistoryRecord[] = []

      for (const line of raw.split('\n').map((entry) => entry.trim())) {
        if (!line.startsWith('- ') || !line.includes(' | ')) {
          continue
        }

        const matched = line.match(
          /^-\s+\d+\.\s+([^|]+)\|\s+([^|]+)(?:\s+\|\s+title:\s*(.+))?$/i
        )
        if (!matched) {
          continue
        }

        records.push({
          timestamp: matched[1]?.trim() || '',
          domain: (matched[2] || '').trim().toLowerCase(),
          title: (matched[3] || '').trim()
        })
      }

      return records
    } catch {
      return []
    }
  }

  private normalizeState(state: MediaProfileState, nowIso: string): MediaProfileState {
    const trackingStartedAt = Number.isFinite(Date.parse(state.trackingStartedAt || ''))
      ? state.trackingStartedAt
      : nowIso
    const lastSampleAt = Number.isFinite(Date.parse(state.lastSampleAt || ''))
      ? state.lastSampleAt
      : nowIso

    return {
      trackingStartedAt,
      lastSampleAt,
      seenEntries:
        state.seenEntries && typeof state.seenEntries === 'object' ? state.seenEntries : {},
      domains: state.domains && typeof state.domains === 'object' ? state.domains : {}
    }
  }

  private updateState(
    state: MediaProfileState,
    records: BrowserHistoryRecord[],
    nowIso: string
  ): MediaProfileState {
    const seenEntries = { ...state.seenEntries }
    const domains = { ...state.domains }

    for (const record of records) {
      if (!record.domain) {
        continue
      }

      const uniqueId = `${record.timestamp}|${record.domain}|${record.title}`
      if (seenEntries[uniqueId]) {
        continue
      }

      seenEntries[uniqueId] = nowIso
      domains[record.domain] = (domains[record.domain] || 0) + 1
    }

    const compactedSeenEntries = Object.entries(seenEntries)
      .sort((entryA, entryB) => (entryA[1] < entryB[1] ? 1 : -1))
      .slice(0, MAX_SEEN_ENTRIES)
    const compactedSeen: Record<string, string> = {}
    for (const [key, value] of compactedSeenEntries) {
      compactedSeen[key] = value
    }

    return {
      trackingStartedAt: state.trackingStartedAt,
      lastSampleAt: nowIso,
      seenEntries: compactedSeen,
      domains
    }
  }

  private rankCounts(counts: Record<string, number>): Array<{ key: string, value: number }> {
    return Object.entries(counts)
      .filter((entry) => Number.isFinite(entry[1]) && entry[1] > 0)
      .map(([key, value]) => ({ key, value }))
      .sort((entryA, entryB) => entryB.value - entryA.value)
  }

  private buildMediaSignals(
    runningApps: string[],
    topDomains: string[]
  ): string[] {
    const signals = new Set<string>()
    const running = runningApps.join(' ')
    const domains = topDomains.join(' ')

    if (/spotify/.test(running) || domains.includes('spotify.com')) {
      signals.add('Spotify usage signal detected')
    }
    if (/netflix/.test(domains)) {
      signals.add('Netflix browsing signal detected')
    }
    if (/youtube/.test(domains) || /ytmusic/.test(domains)) {
      signals.add('YouTube / YouTube Music signal detected')
    }
    if (/bilibili|twitch|vimeo/.test(domains)) {
      signals.add('Alternative streaming platform signal detected')
    }
    if (/vlc|mpv|plex/.test(running)) {
      signals.add('Local media player/server signal detected')
    }

    return [...signals]
  }
}
