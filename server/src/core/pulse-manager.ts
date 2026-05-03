import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type { MessageLog } from '@/types'
import {
  LEON_PULSE_ENABLED,
  LEON_PULSE_INTERVAL_MS,
  PROFILE_CONTEXT_PATH
} from '@/constants'
import { runInference } from '@/core/llm-manager/inference'
import { DateHelper } from '@/helpers/date-helper'
import { LogHelper } from '@/helpers/log-helper'

type PulseMatterStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'declined'
  | 'suppressed'
  | 'failed'

type PulseMatterSource = 'memory' | 'context' | 'self_model'
type PulseOwnerFeedback = 'accept' | 'decline' | null

interface PulseMatter {
  id: string
  fingerprint: string
  intentKey: string
  targetScope: string
  summary: string
  why: string
  turnPrompt: string
  confidence: number
  sources: PulseMatterSource[]
  notifyOwner: boolean
  status: PulseMatterStatus
  createdAt: string
  updatedAt: string
  completedAt: string | null
  surfacedAt: string | null
  outcome: string | null
  ownerFeedback: PulseOwnerFeedback
  ownerFeedbackAt: string | null
}

interface PulseSuppressionPolicy {
  fingerprint: string
  intentKey: string
  targetScope: string
  lastSummary: string
  lastOutcome: 'completed' | 'failed' | 'declined' | 'suppressed' | null
  declineCount: number
  suppressedUntil: string | null
  lastUpdatedAt: string
  ownerPreference: string | null
  behavioralPrinciple: string | null
}

interface PulseTickRecord {
  at: string
  outcome: 'idle' | 'queued' | 'executed' | 'skipped' | 'failed'
  note: string
  matterId: string | null
}

interface PulseState {
  version: 1
  enabled: boolean
  intervalMs: number
  lastTickAt: string | null
  lastGeneratedAt: string | null
  lastExecutionAt: string | null
  lastSurfacedMatterId: string | null
  lastSurfacedAt: string | null
  matters: PulseMatter[]
  recentOutcomes: PulseMatter[]
  suppressionPolicies: PulseSuppressionPolicy[]
  recentTicks: PulseTickRecord[]
  contextFileStamps: Record<string, number>
}

interface PulsePlannerItem {
  intent_key?: string
  target_scope?: string
  summary?: string
  why?: string
  turn_prompt?: string
  confidence?: number
  sources?: string[]
  notify_owner?: boolean
}

interface PulsePlannerOutput {
  items?: PulsePlannerItem[]
}

interface PulseOwnerReactionOutput {
  reaction?: 'decline' | 'accept' | 'neutral'
  durable_preference?: boolean
  preference_memory?: string | null
  behavioral_principle?: string | null
}

const PRIVATE_CONTEXT_DIR = path.join(PROFILE_CONTEXT_PATH, 'private')
const PULSE_MARKDOWN_PATH = path.join(PRIVATE_CONTEXT_DIR, 'PULSE.md')
const PULSE_STATE_PATH = path.join(PRIVATE_CONTEXT_DIR, '.leon-pulse-state.json')
const MAX_PENDING_MATTERS = 6
const MAX_RECENT_OUTCOMES = 12
const MAX_SUPPRESSION_POLICIES = 24
const MAX_RECENT_TICKS = 12
const MAX_CHANGED_CONTEXT_SIGNALS = 6
const ACTIVE_CONVERSATION_GRACE_MS = 2 * 60 * 1_000
const PULSE_INITIAL_DELAY_MS = 2 * 60 * 1_000
const PULSE_SURFACED_RESPONSE_WINDOW_MS = 30 * 60 * 1_000
const PULSE_COMPLETED_COOLDOWN_MS = 12 * 60 * 60 * 1_000
const PULSE_FAILED_COOLDOWN_MS = 3 * 60 * 60 * 1_000
const PULSE_DECLINE_COOLDOWN_MS = [
  24 * 60 * 60 * 1_000,
  7 * 24 * 60 * 60 * 1_000,
  30 * 24 * 60 * 60 * 1_000
]
const PULSE_MEMORY_QUERY =
  'owner priorities recent work unresolved issues recurring friction follow up commitments useful proactive actions'
const PULSE_MEMORY_TOKEN_BUDGET = 260
const PULSE_PLANNER_MAX_TOKENS = 360
const PULSE_OWNER_REACTION_MAX_TOKENS = 180
const PULSE_REACT_SENTINEL = '[Pulse]'

function normalizeText(value: string): string {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
}

function clipText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value
  }

  return `${value.slice(0, maxChars).trimEnd()}...`
}

function toIsoString(value: number): string {
  return new Date(value).toISOString()
}

function formatDateTime(value: string | null | undefined, fallback = 'never'): string {
  if (!value) {
    return fallback
  }

  return DateHelper.getDateTime(value) || value
}

function computeHash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function toConfidence(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.max(0, Math.min(1, parsed))
}

function normalizeIntentToken(value: string, fallback: string): string {
  const normalized = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  return normalized || fallback
}

function parseIsoTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null
  }

  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function normalizeMatterStatus(value: unknown): PulseMatterStatus {
  switch (value) {
    case 'running':
    case 'completed':
    case 'declined':
    case 'suppressed':
    case 'failed':
      return value
    default:
      return 'pending'
  }
}

function normalizeOwnerFeedback(value: unknown): PulseOwnerFeedback {
  if (value === 'accept' || value === 'decline') {
    return value
  }

  return null
}

function normalizeSources(value: unknown): PulseMatterSource[] {
  if (!Array.isArray(value)) {
    return []
  }

  const output = value
    .filter(
      (item): item is PulseMatterSource =>
        item === 'memory' || item === 'context' || item === 'self_model'
    )
    .slice(0, 3)

  return [...new Set(output)]
}

function firstNonEmptyLine(content: string): string {
  return (
    content
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) || ''
  )
}

function defaultPulseState(): PulseState {
  return {
    version: 1,
    enabled: LEON_PULSE_ENABLED,
    intervalMs: LEON_PULSE_INTERVAL_MS,
    lastTickAt: null,
    lastGeneratedAt: null,
    lastExecutionAt: null,
    lastSurfacedMatterId: null,
    lastSurfacedAt: null,
    matters: [],
    recentOutcomes: [],
    suppressionPolicies: [],
    recentTicks: [],
    contextFileStamps: {}
  }
}

export default class PulseManager {
  private static instance: PulseManager

  private state: PulseState | null = null
  private intervalId: NodeJS.Timeout | null = null
  private initialTimerId: NodeJS.Timeout | null = null
  private queue: Promise<void> = Promise.resolve()
  private isTickPending = false

  public constructor() {
    if (!PulseManager.instance) {
      LogHelper.title('Pulse Manager')
      LogHelper.success('New instance')

      PulseManager.instance = this
      this.ensureLoaded()
      this.persist()
    }
  }

  public start(): void {
    const state = this.ensureLoaded()
    state.enabled = LEON_PULSE_ENABLED
    state.intervalMs = LEON_PULSE_INTERVAL_MS
    this.persist()

    if (this.intervalId || this.initialTimerId) {
      return
    }

    if (!LEON_PULSE_ENABLED) {
      LogHelper.title('Pulse Manager')
      LogHelper.info('Pulse is disabled')
      return
    }

    const initialDelayMs = Math.min(
      LEON_PULSE_INTERVAL_MS,
      PULSE_INITIAL_DELAY_MS
    )

    this.initialTimerId = setTimeout(() => {
      this.initialTimerId = null
      void this.tick('initial')
    }, initialDelayMs)
    if (typeof this.initialTimerId.unref === 'function') {
      this.initialTimerId.unref()
    }

    this.intervalId = setInterval(() => {
      void this.tick('scheduled')
    }, LEON_PULSE_INTERVAL_MS)
    if (typeof this.intervalId.unref === 'function') {
      this.intervalId.unref()
    }

    LogHelper.title('Pulse Manager')
    LogHelper.info(
      `Pulse started with interval ${Math.round(LEON_PULSE_INTERVAL_MS / 60_000)} minute(s)`
    )
  }

  public async observeOwnerUtterance(utterance: string): Promise<void> {
    const ownerMessage = normalizeText(utterance)
    if (!ownerMessage) {
      return
    }

    this.queue = this.queue
      .then(async () => {
        await this.observeOwnerUtteranceInternal(ownerMessage)
      })
      .catch((error: unknown) => {
        LogHelper.title('Pulse Manager')
        LogHelper.warning(
          `Failed to observe owner pulse feedback: ${String(error)}`
        )
      })

    return this.queue
  }

  public async tick(reason: 'initial' | 'scheduled' | 'manual'): Promise<void> {
    if (this.isTickPending) {
      return
    }

    this.isTickPending = true
    this.queue = this.queue
      .then(async () => {
        await this.tickInternal(reason)
      })
      .catch((error: unknown) => {
        LogHelper.title('Pulse Manager')
        LogHelper.warning(`Pulse tick failed: ${String(error)}`)
      })
      .finally(() => {
        this.isTickPending = false
      })

    return this.queue
  }

  private ensureLoaded(): PulseState {
    if (this.state) {
      return this.state
    }

    try {
      if (fs.existsSync(PULSE_STATE_PATH)) {
        const raw = fs.readFileSync(PULSE_STATE_PATH, 'utf8')
        const parsed = JSON.parse(raw) as Partial<PulseState>
        this.state = {
          ...defaultPulseState(),
          ...parsed,
          matters: this.normalizeMatters(parsed.matters || []),
          recentOutcomes: this.normalizeMatters(parsed.recentOutcomes || []),
          suppressionPolicies: this.normalizePolicies(
            parsed.suppressionPolicies || []
          ),
          recentTicks: this.normalizeTicks(parsed.recentTicks || []),
          contextFileStamps: this.normalizeContextFileStamps(
            parsed.contextFileStamps || {}
          )
        }
      } else {
        this.state = defaultPulseState()
      }
    } catch {
      this.state = defaultPulseState()
    }

    return this.state
  }

  private normalizeContextFileStamps(
    value: unknown
  ): Record<string, number> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {}
    }

    const output: Record<string, number> = {}
    for (const [key, rawValue] of Object.entries(
      value as Record<string, unknown>
    )) {
      const normalizedKey = normalizeText(key)
      const parsedValue = Number(rawValue)
      if (!normalizedKey || !Number.isFinite(parsedValue)) {
        continue
      }

      output[normalizedKey] = parsedValue
    }

    return output
  }

  private normalizeMatters(value: unknown): PulseMatter[] {
    if (!Array.isArray(value)) {
      return []
    }

    const output: PulseMatter[] = []
    for (const item of value) {
      if (!item || typeof item !== 'object') {
        continue
      }

      const record = item as Record<string, unknown>
      const summary = clipText(normalizeText(String(record['summary'] || '')), 160)
      const why = clipText(normalizeText(String(record['why'] || '')), 220)
      const turnPrompt = clipText(
        normalizeText(String(record['turnPrompt'] || '')),
        280
      )
      const intentKey = normalizeIntentToken(
        String(record['intentKey'] || ''),
        'pulse_matter'
      )
      const targetScope = normalizeIntentToken(
        String(record['targetScope'] || ''),
        'general'
      )

      if (!summary || !why || !turnPrompt) {
        continue
      }

      output.push({
        id:
          normalizeText(String(record['id'] || '')) ||
          `pulse-${computeHash(`${intentKey}:${targetScope}:${summary}`).slice(0, 10)}`,
        fingerprint:
          normalizeText(String(record['fingerprint'] || '')) ||
          this.computeFingerprint(intentKey, targetScope),
        intentKey,
        targetScope,
        summary,
        why,
        turnPrompt,
        confidence: toConfidence(record['confidence'], 0.6),
        sources: normalizeSources(record['sources']),
        notifyOwner: record['notifyOwner'] !== false,
        status: normalizeMatterStatus(record['status']),
        createdAt:
          normalizeText(String(record['createdAt'] || '')) ||
          new Date().toISOString(),
        updatedAt:
          normalizeText(String(record['updatedAt'] || '')) ||
          new Date().toISOString(),
        completedAt: normalizeText(String(record['completedAt'] || '')) || null,
        surfacedAt: normalizeText(String(record['surfacedAt'] || '')) || null,
        outcome: normalizeText(String(record['outcome'] || '')) || null,
        ownerFeedback: normalizeOwnerFeedback(record['ownerFeedback']),
        ownerFeedbackAt:
          normalizeText(String(record['ownerFeedbackAt'] || '')) || null
      })

      if (output.length >= MAX_PENDING_MATTERS + MAX_RECENT_OUTCOMES) {
        break
      }
    }

    return output
  }

  private normalizePolicies(value: unknown): PulseSuppressionPolicy[] {
    if (!Array.isArray(value)) {
      return []
    }

    const output: PulseSuppressionPolicy[] = []
    for (const item of value) {
      if (!item || typeof item !== 'object') {
        continue
      }

      const record = item as Record<string, unknown>
      const fingerprint = normalizeText(String(record['fingerprint'] || ''))
      if (!fingerprint) {
        continue
      }

      output.push({
        fingerprint,
        intentKey: normalizeIntentToken(
          String(record['intentKey'] || ''),
          'pulse_matter'
        ),
        targetScope: normalizeIntentToken(
          String(record['targetScope'] || ''),
          'general'
        ),
        lastSummary: clipText(
          normalizeText(String(record['lastSummary'] || '')),
          160
        ),
        lastOutcome:
          record['lastOutcome'] === 'completed' ||
          record['lastOutcome'] === 'failed' ||
          record['lastOutcome'] === 'declined' ||
          record['lastOutcome'] === 'suppressed'
            ? record['lastOutcome']
            : null,
        declineCount: Math.max(0, Number(record['declineCount']) || 0),
        suppressedUntil:
          normalizeText(String(record['suppressedUntil'] || '')) || null,
        lastUpdatedAt:
          normalizeText(String(record['lastUpdatedAt'] || '')) ||
          new Date().toISOString(),
        ownerPreference:
          clipText(normalizeText(String(record['ownerPreference'] || '')), 180) ||
          null,
        behavioralPrinciple:
          clipText(
            normalizeText(String(record['behavioralPrinciple'] || '')),
            180
          ) || null
      })

      if (output.length >= MAX_SUPPRESSION_POLICIES) {
        break
      }
    }

    return output
  }

  private normalizeTicks(value: unknown): PulseTickRecord[] {
    if (!Array.isArray(value)) {
      return []
    }

    const output: PulseTickRecord[] = []
    for (const item of value) {
      if (!item || typeof item !== 'object') {
        continue
      }

      const record = item as Record<string, unknown>
      output.push({
        at:
          normalizeText(String(record['at'] || '')) || new Date().toISOString(),
        outcome:
          record['outcome'] === 'queued' ||
          record['outcome'] === 'executed' ||
          record['outcome'] === 'skipped' ||
          record['outcome'] === 'failed'
            ? record['outcome']
            : 'idle',
        note: clipText(normalizeText(String(record['note'] || '')), 180),
        matterId: normalizeText(String(record['matterId'] || '')) || null
      })

      if (output.length >= MAX_RECENT_TICKS) {
        break
      }
    }

    return output
  }

  private computeFingerprint(intentKey: string, targetScope: string): string {
    return computeHash(`${intentKey}:${targetScope}`)
  }

  private pushTickRecord(
    state: PulseState,
    outcome: PulseTickRecord['outcome'],
    note: string,
    matterId: string | null = null
  ): void {
    state.recentTicks = [
      {
        at: new Date().toISOString(),
        outcome,
        note: clipText(normalizeText(note), 180),
        matterId
      },
      ...state.recentTicks
    ].slice(0, MAX_RECENT_TICKS)
  }

  private getExecutionCooldownRemainingMs(state: PulseState): number {
    const lastExecutionTs = parseIsoTimestamp(state.lastExecutionAt)
    if (lastExecutionTs === null) {
      return 0
    }

    return Math.max(lastExecutionTs + state.intervalMs - Date.now(), 0)
  }

  private async tickInternal(
    reason: 'initial' | 'scheduled' | 'manual'
  ): Promise<void> {
    const state = this.ensureLoaded()
    state.enabled = LEON_PULSE_ENABLED
    state.intervalMs = LEON_PULSE_INTERVAL_MS
    state.lastTickAt = new Date().toISOString()

    if (!LEON_PULSE_ENABLED) {
      this.pushTickRecord(state, 'skipped', 'Pulse is disabled')
      this.persist()
      return
    }

    const executionCooldownRemainingMs = this.getExecutionCooldownRemainingMs(state)
    if (executionCooldownRemainingMs > 0) {
      const remainingMinutes = Math.ceil(executionCooldownRemainingMs / 60_000)
      this.pushTickRecord(
        state,
        'skipped',
        `Skipped pulse execution; ${remainingMinutes} minute(s) remain before the next allowed pulse`
      )
      this.persist()
      return
    }

    const core = await this.loadCoreNodes()
    const recentConversation = await core.CONVERSATION_LOGGER.load({
      nbOfLogsToLoad: 8
    })

    if (this.hasRecentOwnerActivity(recentConversation)) {
      this.pushTickRecord(
        state,
        'skipped',
        'Skipped pulse during active owner conversation'
      )
      this.persist()
      return
    }

    this.pruneState(state)

    const evidence = await this.buildPulseEvidence(state, recentConversation)
    const plannedMatters = await this.generatePulseMatters(evidence)
    state.lastGeneratedAt = new Date().toISOString()

    let queuedCount = 0
    for (const plannedMatter of plannedMatters) {
      queuedCount += this.mergePlannedMatter(state, plannedMatter)
    }

    const nextMatter = this.selectNextMatter(state)
    if (!nextMatter) {
      this.pushTickRecord(
        state,
        queuedCount > 0 ? 'queued' : 'idle',
        queuedCount > 0
          ? `Queued ${queuedCount} pulse matter(s); no autonomous execution selected this tick`
          : `No pulse matter selected (${reason})`
      )
      this.persist()
      return
    }

    this.pushTickRecord(
      state,
      queuedCount > 0 ? 'queued' : 'executed',
      `Executing pulse matter: ${nextMatter.summary}`,
      nextMatter.id
    )
    this.persist()

    await this.executeMatter(state, nextMatter)
  }

  private pruneState(state: PulseState): void {
    const nowTs = Date.now()

    state.matters = state.matters
      .filter((matter) => {
        if (matter.status === 'running') {
          return true
        }

        const updatedAt = parseIsoTimestamp(matter.updatedAt)
        if (updatedAt === null) {
          return true
        }

        return nowTs - updatedAt <= 7 * 24 * 60 * 60 * 1_000
      })
      .slice(0, MAX_PENDING_MATTERS)

    state.recentOutcomes = state.recentOutcomes
      .filter((matter) => {
        const completedAt = parseIsoTimestamp(matter.completedAt || matter.updatedAt)
        if (completedAt === null) {
          return true
        }

        return nowTs - completedAt <= 30 * 24 * 60 * 60 * 1_000
      })
      .slice(0, MAX_RECENT_OUTCOMES)

    state.suppressionPolicies = state.suppressionPolicies
      .filter((policy) => {
        const suppressedUntilTs = parseIsoTimestamp(policy.suppressedUntil)
        if (suppressedUntilTs === null) {
          return policy.declineCount > 0
        }

        return suppressedUntilTs >= nowTs || policy.declineCount > 0
      })
      .slice(0, MAX_SUPPRESSION_POLICIES)
  }

  private hasRecentOwnerActivity(conversation: MessageLog[]): boolean {
    const ownerLog = [...conversation].reverse().find((log) => log.who === 'owner')
    if (!ownerLog) {
      return false
    }

    return Date.now() - ownerLog.sentAt < ACTIVE_CONVERSATION_GRACE_MS
  }

  private async buildPulseEvidence(
    state: PulseState,
    recentConversation: MessageLog[]
  ): Promise<{
    selfModelSnapshot: string
    contextManifest: string
    memoryPack: string
    recentConversationSection: string
    changedContextSection: string
    activeMattersSection: string
    suppressionSection: string
  }> {
    const core = await this.loadCoreNodes()
    const selfModelSnapshot = core.SELF_MODEL_MANAGER.getSnapshot()
    const contextManifest = core.CONTEXT_MANAGER.getManifest()
    let memoryPack = ''
    try {
      memoryPack = await core.MEMORY_MANAGER.buildPlanningMemoryPack(
        PULSE_MEMORY_QUERY,
        PULSE_MEMORY_TOKEN_BUDGET
      )
    } catch (error) {
      LogHelper.title('Pulse Manager')
      LogHelper.warning(
        `Pulse memory evidence skipped for this tick: ${String(error)}`
      )
    }
    const { changedSignals, nextStamps } = await this.collectContextSignals(
      state.contextFileStamps
    )
    state.contextFileStamps = nextStamps

    const recentConversationSection =
      recentConversation.length > 0
        ? recentConversation
            .map((log) => {
              return `- ${log.who === 'owner' ? 'Owner' : 'Leon'}: ${clipText(normalizeText(log.message), 220)}`
            })
            .join('\n')
        : '- none'

    const changedContextSection =
      changedSignals.length > 0
        ? changedSignals.map((signal) => `- ${signal}`).join('\n')
        : '- none'

    const activeMattersSection =
      state.matters.length > 0
        ? state.matters
            .map((matter) => {
              return `- ${matter.intentKey} | ${matter.targetScope} | ${matter.status} | ${matter.summary}`
            })
            .join('\n')
        : '- none'

    const suppressionSection =
      state.suppressionPolicies.length > 0
        ? state.suppressionPolicies
            .slice(0, 8)
            .map((policy) => {
              return `- ${policy.intentKey} | ${policy.targetScope} | outcome=${policy.lastOutcome || 'none'} | declines=${policy.declineCount} | suppressed_until=${policy.suppressedUntil || 'none'}`
            })
            .join('\n')
        : '- none'

    return {
      selfModelSnapshot,
      contextManifest,
      memoryPack,
      recentConversationSection,
      changedContextSection,
      activeMattersSection,
      suppressionSection
    }
  }

  private async collectContextSignals(
    previousStamps: Record<string, number>
  ): Promise<{
    changedSignals: string[]
    nextStamps: Record<string, number>
  }> {
    const entries = await fs.promises.readdir(PROFILE_CONTEXT_PATH, {
      withFileTypes: true
    })
    const nextStamps: Record<string, number> = {}
    const changedSignals: Array<{ mtimeMs: number, signal: string }> = []

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) {
        continue
      }

      const entryPath = path.join(PROFILE_CONTEXT_PATH, entry.name)
      try {
        const stats = await fs.promises.stat(entryPath)
        nextStamps[entry.name] = stats.mtimeMs

        if (Object.keys(previousStamps).length === 0) {
          continue
        }

        const previousMtime = previousStamps[entry.name]
        if (previousMtime && previousMtime >= stats.mtimeMs) {
          continue
        }

        const content = await fs.promises.readFile(entryPath, 'utf8')
        const preview = clipText(firstNonEmptyLine(content), 220)
        changedSignals.push({
          mtimeMs: stats.mtimeMs,
          signal: `${entry.name}: ${preview || 'updated'}`
        })
      } catch {
        // Ignore per-file pulse context signal failures.
      }
    }

    return {
      changedSignals: changedSignals
        .sort((left, right) => right.mtimeMs - left.mtimeMs)
        .slice(0, MAX_CHANGED_CONTEXT_SIGNALS)
        .map((item) => item.signal),
      nextStamps
    }
  }

  private async generatePulseMatters(evidence: {
    selfModelSnapshot: string
    contextManifest: string
    memoryPack: string
    recentConversationSection: string
    changedContextSection: string
    activeMattersSection: string
    suppressionSection: string
  }): Promise<PulseMatter[]> {
    const prompt = [
      'Leon Self-Model Snapshot:',
      evidence.selfModelSnapshot || 'none',
      '',
      'Context Files Available:',
      evidence.contextManifest || 'none',
      '',
      'Memory Pack:',
      evidence.memoryPack || 'none',
      '',
      'Recent Conversation:',
      evidence.recentConversationSection,
      '',
      'Changed Context Signals:',
      evidence.changedContextSection,
      '',
      'Active Pulse Matters:',
      evidence.activeMattersSection,
      '',
      'Suppressed / Declined Patterns:',
      evidence.suppressionSection
    ].join('\n')

    const result = await runInference({
      prompt,
      systemPrompt: [
        'You maintain Leon\'s autonomous pulse queue.',
        'Return exactly one JSON object and nothing else.',
        'Generate only concrete proactive matters Leon can execute autonomously right now without owner clarification.',
        'Use only the provided memory, context, recent conversation, and self-model signals.',
        'Do not generate destructive, expensive, or socially sensitive actions.',
        'If a matter appears suppressed, declined, stale, duplicated, or weakly evidenced, do not include it.',
        'Each matter must represent one autonomous ReAct turn candidate.',
        'Return JSON with this exact shape:',
        '{',
        '  "items": [',
        '    {',
        '      "intent_key": "stable_snake_case_identifier",',
        '      "target_scope": "stable_scope_identifier",',
        '      "summary": "short user-facing matter summary",',
        '      "why": "short evidence-based reason",',
        '      "turn_prompt": "concise autonomous task instruction",',
        '      "confidence": 0.0,',
        '      "sources": ["memory"|"context"|"self_model"],',
        '      "notify_owner": true',
        '    }',
        '  ]',
        '}',
        'Rules:',
        '- Return at most 3 items.',
        '- "intent_key" and "target_scope" must be stable identifiers for deduplication.',
        '- "summary", "why", and "turn_prompt" must be concise and concrete.',
        '- "sources" must only contain memory, context, and/or self_model.',
        '- Prefer matters supported by multiple signals.',
        '- If there is nothing useful to do, return {"items":[]}.'
      ].join('\n'),
      temperature: 0,
      maxTokens: PULSE_PLANNER_MAX_TOKENS,
      trackProviderErrors: false
    })
    const payload = this.parseJsonObject(result?.output) as PulsePlannerOutput | null
    if (!payload?.items || !Array.isArray(payload.items)) {
      return []
    }

    const nowIso = new Date().toISOString()
    const matters: PulseMatter[] = []
    for (const item of payload.items) {
      const normalized = this.normalizePlannedMatter(item, nowIso)
      if (!normalized) {
        continue
      }

      matters.push(normalized)
      if (matters.length >= 3) {
        break
      }
    }

    return matters
  }

  private normalizePlannedMatter(
    item: PulsePlannerItem,
    nowIso: string
  ): PulseMatter | null {
    const summary = clipText(normalizeText(String(item.summary || '')), 160)
    const why = clipText(normalizeText(String(item.why || '')), 220)
    const turnPrompt = clipText(
      normalizeText(String(item.turn_prompt || '')),
      280
    )
    if (!summary || !why || !turnPrompt) {
      return null
    }

    const intentKey = normalizeIntentToken(
      String(item.intent_key || ''),
      'pulse_matter'
    )
    const targetScope = normalizeIntentToken(
      String(item.target_scope || ''),
      'general'
    )
    const fingerprint = this.computeFingerprint(intentKey, targetScope)

    return {
      id: `pulse-${Date.now()}-${fingerprint.slice(0, 6)}`,
      fingerprint,
      intentKey,
      targetScope,
      summary,
      why,
      turnPrompt,
      confidence: toConfidence(item.confidence, 0.65),
      sources: normalizeSources(item.sources),
      notifyOwner: item.notify_owner !== false,
      status: 'pending',
      createdAt: nowIso,
      updatedAt: nowIso,
      completedAt: null,
      surfacedAt: null,
      outcome: null,
      ownerFeedback: null,
      ownerFeedbackAt: null
    }
  }

  private mergePlannedMatter(state: PulseState, matter: PulseMatter): number {
    const policy = state.suppressionPolicies.find(
      (entry) => entry.fingerprint === matter.fingerprint
    )
    const suppressedUntilTs = parseIsoTimestamp(policy?.suppressedUntil)
    if (suppressedUntilTs !== null && suppressedUntilTs > Date.now()) {
      return 0
    }

    const existing = state.matters.find(
      (entry) => entry.fingerprint === matter.fingerprint
    )
    if (existing) {
      existing.summary = matter.summary
      existing.why = matter.why
      existing.turnPrompt = matter.turnPrompt
      existing.confidence = Math.max(existing.confidence, matter.confidence)
      existing.sources = [...new Set([...existing.sources, ...matter.sources])]
      existing.notifyOwner = existing.notifyOwner || matter.notifyOwner
      existing.updatedAt = matter.updatedAt
      if (existing.status !== 'running') {
        existing.status = 'pending'
      }
      return 0
    }

    state.matters = [...state.matters, matter]
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, MAX_PENDING_MATTERS)

    return 1
  }

  private selectNextMatter(state: PulseState): PulseMatter | null {
    const pendingMatters = state.matters
      .filter((matter) => matter.status === 'pending')
      .sort((left, right) => {
        if (right.confidence !== left.confidence) {
          return right.confidence - left.confidence
        }

        return right.updatedAt.localeCompare(left.updatedAt)
      })

    return pendingMatters[0] || null
  }

  private async executeMatter(
    state: PulseState,
    matter: PulseMatter
  ): Promise<void> {
    matter.status = 'running'
    matter.updatedAt = new Date().toISOString()
    this.persist()

    const input = [
      `${PULSE_REACT_SENTINEL} Autonomous task.`,
      'This task was initiated by Leon proactively.',
      'Use current context, memory, and tools to help the owner.',
      'Do not ask the owner for clarification. If you cannot proceed safely with the available evidence, stop briefly and explain the block.',
      `Task: ${matter.turnPrompt}`,
      `Why this matters: ${matter.why}`
    ].join('\n')

    let output = ''
    let finalIntent: 'answer' | 'clarification' | 'cancelled' | 'blocked' | 'error' =
      'answer'
    let toolExecutions: Array<{
      functionName: string
      status: 'success' | 'error'
      observation: string
    }> = []

    try {
      const { ReActLLMDuty } = await this.loadReActLLMDuty()
      const duty = new ReActLLMDuty({
        input
      })
      await duty.init()
      const result = await duty.execute()
      output = typeof result?.output === 'string' ? result.output : ''
      const resultData =
        result?.data && typeof result.data === 'object'
          ? (result.data as Record<string, unknown>)
          : {}

      finalIntent =
        typeof resultData['finalIntent'] === 'string'
          ? (resultData['finalIntent'] as typeof finalIntent)
          : 'answer'
      toolExecutions = this.extractToolExecutions(resultData['executionHistory'])
    } catch (error) {
      finalIntent = 'error'
      output = `Pulse execution failed: ${String(error)}`
    }

    const nowTs = Date.now()
    const nowIso = toIsoString(nowTs)
    matter.updatedAt = nowIso
    matter.completedAt = nowIso
    matter.outcome = clipText(normalizeText(output), 600) || null

    if (finalIntent === 'answer') {
      matter.status = 'completed'
      this.upsertSuppressionPolicy(state, matter, 'completed', nowIso)
      state.lastExecutionAt = nowIso
    } else {
      matter.status = 'failed'
      this.upsertSuppressionPolicy(state, matter, 'failed', nowIso)
      state.lastExecutionAt = nowIso
    }

    const core = await this.loadCoreNodes()
    if (output) {
      await core.MEMORY_MANAGER.observeTurn({
        userMessage: `${PULSE_REACT_SENTINEL} ${matter.turnPrompt}`,
        assistantMessage: output,
        sentAt: nowTs,
        route: 'pulse',
        toolExecutions
      })
      await core.SELF_MODEL_MANAGER.observeTurn({
        userMessage: `${PULSE_REACT_SENTINEL} ${matter.turnPrompt}`,
        assistantMessage: output,
        sentAt: nowTs,
        route: 'pulse',
        finalIntent,
        toolExecutions
      })
    }

    if (output && matter.notifyOwner) {
      await this.surfacePulseMessage(state, matter, output)
    }

    state.matters = state.matters.filter((entry) => entry.id !== matter.id)
    state.recentOutcomes = [matter, ...state.recentOutcomes].slice(
      0,
      MAX_RECENT_OUTCOMES
    )
    this.pushTickRecord(
      state,
      finalIntent === 'answer' ? 'executed' : 'failed',
      finalIntent === 'answer'
        ? `Completed pulse matter: ${matter.summary}`
        : `Pulse matter failed: ${matter.summary}`,
      matter.id
    )
    this.persist()
  }

  private async surfacePulseMessage(
    state: PulseState,
    matter: PulseMatter,
    output: string
  ): Promise<void> {
    const core = await this.loadCoreNodes()
    core.SOCKET_SERVER.emitAnswerToChatClients(output)
    await core.CONVERSATION_LOGGER.push({
      who: 'leon',
      message: output,
      isAddedToHistory: true
    })

    const nowIso = new Date().toISOString()
    matter.surfacedAt = nowIso
    state.lastSurfacedMatterId = matter.id
    state.lastSurfacedAt = nowIso
  }

  private extractToolExecutions(
    value: unknown
  ): Array<{
    functionName: string
    status: 'success' | 'error'
    observation: string
  }> {
    if (!Array.isArray(value)) {
      return []
    }

    return value
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null
        }

        const record = item as Record<string, unknown>
        const functionName = normalizeText(String(record['function'] || ''))
        if (!functionName) {
          return null
        }

        return {
          functionName,
          status: record['status'] === 'error' ? 'error' : 'success',
          observation: normalizeText(String(record['observation'] || ''))
        }
      })
      .filter(
        (
          item
        ): item is {
          functionName: string
          status: 'success' | 'error'
          observation: string
        } => Boolean(item)
      )
  }

  private async observeOwnerUtteranceInternal(
    ownerMessage: string
  ): Promise<void> {
    const state = this.ensureLoaded()
    const surfacedAtTs = parseIsoTimestamp(state.lastSurfacedAt)
    if (
      !state.lastSurfacedMatterId ||
      surfacedAtTs === null ||
      Date.now() - surfacedAtTs > PULSE_SURFACED_RESPONSE_WINDOW_MS
    ) {
      return
    }

    const matter = this.findMatterById(state, state.lastSurfacedMatterId)
    if (!matter || matter.ownerFeedbackAt) {
      return
    }

    const reaction = await this.classifyOwnerReaction(matter, ownerMessage)
    if (!reaction || reaction.reaction === 'neutral') {
      return
    }

    const nowIso = new Date().toISOString()
    matter.ownerFeedback = reaction.reaction === 'accept' ? 'accept' : 'decline'
    matter.ownerFeedbackAt = nowIso

    if (reaction.reaction === 'decline') {
      const policy = this.upsertSuppressionPolicy(state, matter, 'declined', nowIso)
      policy.declineCount += 1
      policy.suppressedUntil = toIsoString(
        Date.now() + this.getDeclineCooldownMs(policy.declineCount)
      )
      policy.ownerPreference =
        clipText(normalizeText(reaction.preference_memory || ''), 180) || null
      policy.behavioralPrinciple =
        clipText(normalizeText(reaction.behavioral_principle || ''), 180) || null
      policy.lastUpdatedAt = nowIso
      policy.lastOutcome = 'declined'

      this.applySuppressionToPendingMatters(state, matter.fingerprint, nowIso)

      const core = await this.loadCoreNodes()
      if (reaction.durable_preference && policy.ownerPreference) {
        await core.MEMORY_MANAGER.rememberExplicit(policy.ownerPreference, {
          source: 'pulse_owner_feedback',
          fingerprint: matter.fingerprint
        })
      }
      if (policy.behavioralPrinciple) {
        await core.SELF_MODEL_MANAGER.reinforceBehavioralPrinciple(
          policy.behavioralPrinciple,
          0.92
        )
      }
    }

    this.persist()
  }

  private applySuppressionToPendingMatters(
    state: PulseState,
    fingerprint: string,
    nowIso: string
  ): void {
    const suppressedMatters = state.matters.filter(
      (matter) =>
        matter.fingerprint === fingerprint && matter.status === 'pending'
    )

    if (suppressedMatters.length === 0) {
      return
    }

    state.matters = state.matters.filter(
      (matter) =>
        matter.fingerprint !== fingerprint || matter.status !== 'pending'
    )

    for (const matter of suppressedMatters) {
      const updatedMatter: PulseMatter = {
        ...matter,
        status: 'suppressed',
        updatedAt: nowIso,
        completedAt: nowIso,
        outcome:
          'Suppressed after the owner declined a similar pulse action.'
      }
      state.recentOutcomes.unshift(updatedMatter)
    }

    state.recentOutcomes = state.recentOutcomes.slice(0, MAX_RECENT_OUTCOMES)
  }

  private async classifyOwnerReaction(
    matter: PulseMatter,
    ownerMessage: string
  ): Promise<PulseOwnerReactionOutput | null> {
    const prompt = [
      'Recent pulse matter:',
      `- Summary: ${matter.summary}`,
      `- Why: ${matter.why}`,
      `- Turn prompt: ${matter.turnPrompt}`,
      `- Leon surfaced message: ${matter.outcome || 'none'}`,
      '',
      'Owner reply:',
      ownerMessage
    ].join('\n')

    const result = await runInference({
      prompt,
      systemPrompt: [
        'You classify the owner\'s reaction to Leon\'s recent autonomous pulse action.',
        'Return exactly one JSON object and nothing else.',
        'Return JSON with this exact shape:',
        '{',
        '  "reaction": "decline" | "accept" | "neutral",',
        '  "durable_preference": boolean,',
        '  "preference_memory": string|null,',
        '  "behavioral_principle": string|null',
        '}',
        'Rules:',
        '- "decline" means the owner rejects this proactive behavior or does not want this kind of autonomous action.',
        '- "accept" means the owner approves or welcomes it.',
        '- "neutral" means unrelated or too ambiguous.',
        '- "preference_memory" should be a short durable owner-preference sentence only when clearly expressed.',
        '- "behavioral_principle" should be a short first-person Leon adaptation only when a decline implies a future adjustment.'
      ].join('\n'),
      temperature: 0,
      maxTokens: PULSE_OWNER_REACTION_MAX_TOKENS,
      trackProviderErrors: false
    })
    return this.parseJsonObject(result?.output) as PulseOwnerReactionOutput | null
  }

  private upsertSuppressionPolicy(
    state: PulseState,
    matter: PulseMatter,
    outcome: PulseSuppressionPolicy['lastOutcome'],
    nowIso: string
  ): PulseSuppressionPolicy {
    const existing = state.suppressionPolicies.find(
      (entry) => entry.fingerprint === matter.fingerprint
    )

    const suppressedUntil =
      outcome === 'completed'
        ? toIsoString(Date.now() + PULSE_COMPLETED_COOLDOWN_MS)
        : outcome === 'failed'
          ? toIsoString(Date.now() + PULSE_FAILED_COOLDOWN_MS)
          : existing?.suppressedUntil || null

    if (existing) {
      existing.lastSummary = matter.summary
      existing.lastOutcome = outcome
      existing.suppressedUntil = suppressedUntil
      existing.lastUpdatedAt = nowIso
      return existing
    }

    const policy: PulseSuppressionPolicy = {
      fingerprint: matter.fingerprint,
      intentKey: matter.intentKey,
      targetScope: matter.targetScope,
      lastSummary: matter.summary,
      lastOutcome: outcome,
      declineCount: 0,
      suppressedUntil,
      lastUpdatedAt: nowIso,
      ownerPreference: null,
      behavioralPrinciple: null
    }

    state.suppressionPolicies = [policy, ...state.suppressionPolicies].slice(
      0,
      MAX_SUPPRESSION_POLICIES
    )
    return policy
  }

  private getDeclineCooldownMs(declineCount: number): number {
    const index = Math.min(
      Math.max(declineCount - 1, 0),
      PULSE_DECLINE_COOLDOWN_MS.length - 1
    )

    return PULSE_DECLINE_COOLDOWN_MS[index] || PULSE_DECLINE_COOLDOWN_MS[0]!
  }

  private findMatterById(
    state: PulseState,
    matterId: string
  ): PulseMatter | null {
    return (
      state.matters.find((matter) => matter.id === matterId) ||
      state.recentOutcomes.find((matter) => matter.id === matterId) ||
      null
    )
  }

  private async loadCoreNodes(): Promise<{
    CONTEXT_MANAGER: {
      getManifest(): string
    }
    CONVERSATION_LOGGER: {
      load(params?: { nbOfLogsToLoad?: number }): Promise<MessageLog[]>
      push(record: Omit<MessageLog, 'sentAt'>): Promise<void>
    }
    MEMORY_MANAGER: {
      buildPlanningMemoryPack(query: string, tokenBudget?: number): Promise<string>
      observeTurn(input: {
        userMessage: string
        assistantMessage: string
        sentAt: number
        route: 'react' | 'controlled' | 'pulse'
        toolExecutions?: Array<{
          functionName: string
          status: 'success' | 'error'
          observation: string
        }>
      }): Promise<void>
      rememberExplicit(
        text: string,
        metadata?: Record<string, unknown>
      ): Promise<unknown>
    }
    SELF_MODEL_MANAGER: {
      getSnapshot(): string
      observeTurn(input: {
        userMessage: string
        assistantMessage: string
        sentAt?: number
        route: 'react' | 'controlled' | 'pulse'
        finalIntent?: 'answer' | 'clarification' | 'cancelled' | 'blocked' | 'error'
        toolExecutions?: Array<{
          functionName: string
          status: 'success' | 'error'
          observation: string
        }>
      }): Promise<void>
      reinforceBehavioralPrinciple(
        text: string,
        confidence?: number
      ): Promise<void>
    }
    SOCKET_SERVER: {
      emitAnswerToChatClients(answerData: unknown): void
      socket?: {
        emit(eventName: string, ...args: unknown[]): void
      } | null
    }
  }> {
    return this.loadModule('index')
  }

  private async loadReActLLMDuty(): Promise<{
    ReActLLMDuty: {
      new (params: { input: string }): {
        init(): Promise<void>
        execute(): Promise<{
          output: unknown
          data?: Record<string, unknown>
        } | null>
      }
    }
  }> {
    return this.loadModule(path.join('llm-manager', 'llm-duties', 'react-llm-duty'))
  }

  private async loadModule<T>(relativePathFromCore: string): Promise<T> {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const candidatePaths = [
      path.join(currentDir, `${relativePathFromCore}.js`),
      path.join(currentDir, `${relativePathFromCore}.ts`)
    ]
    const modulePath = candidatePaths.find((candidate) => fs.existsSync(candidate))
    if (!modulePath) {
      throw new Error(`Module not found: ${relativePathFromCore}`)
    }

    return (await import(pathToFileURL(modulePath).href)) as T
  }

  private parseJsonObject(output: unknown): Record<string, unknown> | null {
    if (output && typeof output === 'object' && !Array.isArray(output)) {
      return output as Record<string, unknown>
    }

    if (typeof output !== 'string') {
      return null
    }

    const normalized = output.trim()
    if (!normalized) {
      return null
    }

    const jsonStart = normalized.indexOf('{')
    const jsonEnd = normalized.lastIndexOf('}')
    if (jsonStart === -1 || jsonEnd <= jsonStart) {
      return null
    }

    try {
      return JSON.parse(normalized.slice(jsonStart, jsonEnd + 1)) as Record<
        string,
        unknown
      >
    } catch {
      return null
    }
  }

  private persist(): void {
    const state = this.ensureLoaded()

    try {
      fs.mkdirSync(PRIVATE_CONTEXT_DIR, { recursive: true })
      fs.writeFileSync(PULSE_STATE_PATH, JSON.stringify(state, null, 2), 'utf8')
      fs.writeFileSync(PULSE_MARKDOWN_PATH, this.renderMarkdown(state), 'utf8')
    } catch (error) {
      LogHelper.title('Pulse Manager')
      LogHelper.warning(`Failed to persist pulse state: ${String(error)}`)
    }
  }

  private renderMarkdown(state: PulseState): string {
    const matterLines =
      state.matters.length > 0
        ? state.matters.map((matter) =>
            [
              `### ${matter.id}`,
              `- Status: ${matter.status}`,
              `- Summary: ${matter.summary}`,
              `- Confidence: ${matter.confidence.toFixed(2)}`,
              `- Sources: ${matter.sources.join(', ') || 'none'}`,
              `- Why: ${matter.why}`,
              `- Turn Prompt: ${matter.turnPrompt}`,
              `- Notify Owner: ${matter.notifyOwner ? 'yes' : 'no'}`,
              `- Updated At: ${formatDateTime(matter.updatedAt)}`
            ].join('\n')
          )
        : ['- No pending pulse matters right now']

    const suppressionLines =
      state.suppressionPolicies.length > 0
        ? state.suppressionPolicies.map((policy) =>
            [
              `### ${policy.intentKey}:${policy.targetScope}`,
              `- Last Outcome: ${policy.lastOutcome || 'none'}`,
              `- Declines: ${policy.declineCount}`,
              `- Suppressed Until: ${formatDateTime(policy.suppressedUntil, 'none')}`,
              `- Owner Preference: ${policy.ownerPreference || 'none'}`,
              `- Behavioral Principle: ${policy.behavioralPrinciple || 'none'}`
            ].join('\n')
          )
        : ['- No suppressed or declined pulse patterns']

    const outcomeLines =
      state.recentOutcomes.length > 0
        ? state.recentOutcomes.map((matter) =>
            [
              `### ${matter.id}`,
              `- Status: ${matter.status}`,
              `- Summary: ${matter.summary}`,
              `- Outcome: ${matter.outcome || 'none'}`,
              `- Owner Feedback: ${matter.ownerFeedback || 'none'}`,
              `- Completed At: ${formatDateTime(matter.completedAt || matter.updatedAt)}`
            ].join('\n')
          )
        : ['- No recent pulse outcomes']

    return [
      '> Leon\'s autonomous pulse queue. Private runtime agenda for proactive action.',
      '# PULSE',
      `- Enabled: ${state.enabled ? 'true' : 'false'}`,
      `- Interval: ${Math.round(state.intervalMs / 60_000)}m`,
      `- Last Tick: ${formatDateTime(state.lastTickAt)}`,
      `- Last Generated: ${formatDateTime(state.lastGeneratedAt)}`,
      `- Last Execution: ${formatDateTime(state.lastExecutionAt)}`,
      `- Last Surfaced Matter: ${state.lastSurfacedMatterId || 'none'}`,
      '## Queue',
      ...matterLines,
      '## Suppressed / Declined',
      ...suppressionLines,
      '## Recent Outcomes',
      ...outcomeLines
    ].join('\n')
  }
}
