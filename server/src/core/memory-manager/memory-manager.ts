import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { gzipSync } from 'node:zlib'

import {
  PROFILE_CONTEXT_PATH,
  PROFILE_MEMORY_DB_PATH,
  PROFILE_MEMORY_PATH
} from '@/constants'
import { LLMDuties, LLMProviders } from '@/core/llm-manager/types'
import { LogHelper } from '@/helpers/log-helper'
import { CONFIG_STATE } from '@/core/config-states/config-state'

import MemoryRepository from './memory-repository'
import QMDBackend from './qmd-backend'
import { buildDailyMarkdownSummary } from './summarizer'
import type {
  KnowledgeNamespace,
  MemoryRecord,
  MemoryWriteInput,
  RecallHit,
  RecallQuery,
  RecallResult,
  TurnObservationInput
} from './types'

const CONTEXT_SYNC_TTL_MS = 5 * 60 * 1_000
const LEON_MEMORY_DISCUSSION_TTL_DAYS = 5
const LEON_MEMORY_RECALL_TOP_K = 12
const LEON_MEMORY_PLANNING_RECALL_TOP_K = 6
const LEON_MEMORY_PLANNING_TOKEN_BUDGET = 220
const LEON_MEMORY_EXECUTION_TOKEN_BUDGET = 480
const PERSISTENT_EXTRACTION_TIMEOUT_MS = 45_000
const PERSISTENT_EXTRACTION_MAX_RETRIES = 1
const PERSISTENT_EXTRACTION_MAX_TOKENS = 220
const PERSISTENT_EXTRACTION_MAX_USER_CHARS = 1_600
const PERSISTENT_EXTRACTION_MAX_ASSISTANT_CHARS = 1_200
const STORAGE_MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1_000
const SOFT_DELETED_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000
const DISCUSSION_ACTIVE_RETENTION_DAYS = 30
const DISCUSSION_COLD_ARCHIVE_AFTER_DAYS = 180
const DAILY_FULL_RETENTION_DAYS = 90
const QMD_INDEX_NAME = 'leon-memory'
const DAILY_SUMMARY_QUEUE_STALE_MS = 2 * 60 * 1_000
const PERSISTENT_SIMILARITY_JACCARD_THRESHOLD = 0.84
const PERSISTENT_SIMILARITY_CONTAINMENT_MIN_CHARS = 40
const RECALL_MIN_QUERY_TERMS = 3
const MIN_TRUNCATED_RECALL_TOKENS = 48
const TRUNCATED_RECALL_BUDGET_RATIO = 0.6
const PERSISTENT_SIMILARITY_LOOKBACK = 300
const DISCUSSION_TTL_MS = LEON_MEMORY_DISCUSSION_TTL_DAYS * 24 * 60 * 60 * 1_000
const DAY_MS = 24 * 60 * 60 * 1_000
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MAINTENANCE_REPORTS_DIRNAME = 'reports'
const MEMORY_RECOVERY_STATE_FILENAME = '.recovery-state.json'
const MEMORY_MIRROR_RECOVERY_MIGRATION_ID =
  'rebuild_missing_memory_markdown_mirrors_v1'
const EXTRACT_PERSISTENT_MEMORY_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          content: { type: 'string' }
        },
        required: ['content'],
        additionalProperties: false
      }
    }
  },
  required: ['items'],
  additionalProperties: false
} as const

function normalizeContent(content: string): string {
  return content.replace(/\r\n/g, '\n').trim()
}

function tokenizeWords(content: string): string[] {
  return (content.toLowerCase().match(/[a-z0-9_]+/g) || [])
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
}

function tokenizeFilenameWords(filename: string): string[] {
  return (filename.toLowerCase().replace(/\.md$/i, '').match(/[a-z0-9_]+/g) || [])
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
}

function namespaceRecallWeight(namespace: RecallHit['namespace']): number {
  switch (namespace) {
    case 'context':
      return 0.8
    case 'memory_persistent':
      return 1.35
    case 'memory_daily':
      return 0.85
    case 'memory_discussion':
      return 0.65
    case 'conversation_daily':
      return 0.85
    default:
      return 0.8
  }
}

function computeHash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function toDayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

function parseDayKeyFromFilename(filename: string): string | null {
  const dayKey = filename.replace(/\.md(?:\.gz)?$/i, '')
  return DAY_KEY_PATTERN.test(dayKey) ? dayKey : null
}

function dayKeyToTs(dayKey: string): number | null {
  const parsed = Date.parse(`${dayKey}T00:00:00.000Z`)
  return Number.isFinite(parsed) ? parsed : null
}

interface StorageSnapshot {
  memoryDbBytes: number
  qmdDbBytes: number
  persistentBytes: number
  dailyBytes: number
  discussionBytes: number
  discussionWarmArchiveBytes: number
  discussionColdArchiveBytes: number
}

interface MemoryRecoveryState {
  completedMigrations: string[]
}

function renderRecallPrompt(result: RecallResult): string {
  if (!result.hits.length && !result.facts.length) {
    return 'Memory: none'
  }

  const lines: string[] = ['Memory Recall:']

  if (result.facts.length > 0) {
    lines.push('Facts:')
    for (const fact of result.facts) {
      lines.push(`- ${fact.text}`)
    }
  }

  if (result.hits.length > 0) {
    lines.push('Relevant Memory Chunks:')
    for (const [index, hit] of result.hits.entries()) {
      const sourceLabel = hit.sourcePath
        ? path.basename(hit.sourcePath)
        : hit.title || hit.namespace
      lines.push(`${index + 1}. [${sourceLabel}] ${hit.content}`)
    }
  }

  return lines.join('\n')
}

function parseConversationPair(content: string): Array<{ who: 'owner' | 'leon', message: string }> {
  const lines = content.split('\n')
  const ownerLine = lines.find((line) => line.startsWith('Owner:'))
  const leonLine = lines.find((line) => line.startsWith('Leon:'))
  const records: Array<{ who: 'owner' | 'leon', message: string }> = []

  if (ownerLine) {
    records.push({
      who: 'owner',
      message: ownerLine.replace(/^Owner:\s*/i, '').trim()
    })
  }

  if (leonLine) {
    records.push({
      who: 'leon',
      message: leonLine.replace(/^Leon:\s*/i, '').trim()
    })
  }

  return records.filter((record) => record.message.length > 0)
}

function truncateForExtraction(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content
  }

  return `${content.slice(0, maxChars).trimEnd()}...`
}

function shouldAttemptPersistentExtraction(
  userMessage: string,
  assistantMessage: string
): boolean {
  const userWordCount = userMessage.split(/\s+/).filter(Boolean).length
  const assistantWordCount = assistantMessage.split(/\s+/).filter(Boolean).length

  // Keep this generic (no keyword checks): skip only very short/low-signal turns.
  return userWordCount >= 4 || assistantWordCount >= 8
}

export default class MemoryManager {
  private static instance: MemoryManager

  private _isLoaded = false
  private lastContextSyncAt = 0
  private lastStorageMaintenanceAt = 0
  private isStorageMaintenanceRunning = false
  private storageMaintenanceQueued = false
  private readonly repository = new MemoryRepository()
  private readonly qmdBackend = new QMDBackend()
  private readonly contextChecksums = new Map<string, string>()
  private readonly persistentPath = path.join(
    PROFILE_MEMORY_PATH,
    'persistent'
  )
  private readonly dailyPath = path.join(PROFILE_MEMORY_PATH, 'daily')
  private readonly discussionPath = path.join(
    PROFILE_MEMORY_PATH,
    'discussion'
  )
  private readonly archivePath = path.join(PROFILE_MEMORY_PATH, 'archive')
  private readonly reportsPath = path.join(
    PROFILE_MEMORY_PATH,
    MAINTENANCE_REPORTS_DIRNAME
  )
  private readonly discussionWarmArchivePath = path.join(
    this.archivePath,
    'discussion',
    'warm'
  )
  private readonly discussionColdArchivePath = path.join(
    this.archivePath,
    'discussion',
    'cold'
  )
  private readonly recoveryStatePath = path.join(
    PROFILE_MEMORY_PATH,
    MEMORY_RECOVERY_STATE_FILENAME
  )
  private readonly qmdIndexPath = path.join(
    process.env['XDG_CACHE_HOME']
      ? path.join(process.env['XDG_CACHE_HOME'], 'qmd')
      : path.join(os.homedir(), '.cache', 'qmd'),
    `${QMD_INDEX_NAME}.sqlite`
  )
  private readonly dailySummaryQueue = new Map<
    string,
    { promise: Promise<void>, startedAt: number }
  >()

  private getPersistentEntryFilePath(itemId: string, timestamp: number): string {
    const date = new Date(timestamp)
    const year = String(date.getUTCFullYear())
    const month = String(date.getUTCMonth() + 1).padStart(2, '0')
    const day = String(date.getUTCDate()).padStart(2, '0')

    return path.join(this.persistentPath, year, month, day, `${itemId}.md`)
  }

  private getDailySummaryFilePath(dayKey: string): string {
    return path.join(this.dailyPath, `${dayKey}.md`)
  }

  private getDiscussionDayFilePath(dayKey: string): string {
    return path.join(this.discussionPath, `${dayKey}.md`)
  }

  private renderPersistentEntryMarkdown(record: MemoryRecord): string {
    return `> Persistent memory entry (${record.kind})\n\n# ${
      record.title || record.kind
    }\n\nID: ${record.id}\nCreated At: ${new Date(
      record.createdAt
    ).toISOString()}\n\n${record.content}\n`
  }

  private renderDiscussionHeader(dayKey: string): string {
    return `> Discussion memory for ${dayKey}. Short-term rolling conversation context.\n# ${dayKey}\n\n`
  }

  private renderDiscussionLine(record: MemoryRecord): string {
    return `- ${new Date(record.createdAt).toISOString()} | ${record.content.replace(/\n/g, ' | ')}\n`
  }

  private async countMarkdownFiles(
    dirPath: string,
    recursive = false
  ): Promise<number> {
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })
      let count = 0

      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry.name)
        if (entry.isDirectory()) {
          if (recursive) {
            count += await this.countMarkdownFiles(entryPath, true)
          }
          continue
        }

        if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
          count += 1
        }
      }

      return count
    } catch {
      return 0
    }
  }

  private async loadRecoveryState(): Promise<MemoryRecoveryState> {
    try {
      if (!fs.existsSync(this.recoveryStatePath)) {
        return { completedMigrations: [] }
      }

      const state = JSON.parse(
        await fs.promises.readFile(this.recoveryStatePath, 'utf8')
      ) as Partial<MemoryRecoveryState>

      return {
        completedMigrations: Array.isArray(state.completedMigrations)
          ? state.completedMigrations
              .filter((value): value is string => typeof value === 'string')
          : []
      }
    } catch {
      return { completedMigrations: [] }
    }
  }

  private async saveRecoveryState(state: MemoryRecoveryState): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.recoveryStatePath), {
      recursive: true
    })
    await fs.promises.writeFile(
      this.recoveryStatePath,
      `${JSON.stringify(state, null, 2)}\n`,
      'utf8'
    )
  }

  private async rebuildMissingPersistentMirrors(): Promise<number> {
    const records = this.repository.listPersistentMirrorRecords()
    let repairedCount = 0

    for (const record of records) {
      const filePath = this.getPersistentEntryFilePath(record.id, record.createdAt)
      if (fs.existsSync(filePath)) {
        continue
      }

      await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
      await fs.promises.writeFile(
        filePath,
        this.renderPersistentEntryMarkdown(record),
        'utf8'
      )
      repairedCount += 1
    }

    return repairedCount
  }

  private async rebuildMissingDailySummaryMirrors(): Promise<number> {
    const records = this.repository.listDailySummaryMirrorRecords()
    let repairedCount = 0

    for (const record of records) {
      if (!record.dayKey) {
        continue
      }

      const filePath = this.getDailySummaryFilePath(record.dayKey)
      if (fs.existsSync(filePath)) {
        continue
      }

      await fs.promises.writeFile(filePath, record.content, 'utf8')
      repairedCount += 1
    }

    return repairedCount
  }

  private async rebuildMissingDiscussionMirrors(): Promise<number> {
    const records = this.repository.listDiscussionMirrorRecords()
    const recordsByDayKey = new Map<string, MemoryRecord[]>()

    for (const record of records) {
      if (!record.dayKey) {
        continue
      }

      const groupedRecords = recordsByDayKey.get(record.dayKey) || []
      groupedRecords.push(record)
      recordsByDayKey.set(record.dayKey, groupedRecords)
    }

    let repairedDayCount = 0

    for (const [dayKey, dayRecords] of recordsByDayKey.entries()) {
      const filePath = this.getDiscussionDayFilePath(dayKey)
      if (fs.existsSync(filePath)) {
        continue
      }

      const content = `${this.renderDiscussionHeader(dayKey)}${dayRecords
        .map((record) => this.renderDiscussionLine(record))
        .join('')}`
      await fs.promises.writeFile(filePath, content, 'utf8')
      repairedDayCount += 1
    }

    return repairedDayCount
  }

  private async detectMissingMirrorNamespaces(): Promise<KnowledgeNamespace[]> {
    const missingNamespaces: KnowledgeNamespace[] = []
    const persistentFileCount = await this.countMarkdownFiles(this.persistentPath, true)
    const dailyFileCount = await this.countMarkdownFiles(this.dailyPath)
    const discussionFileCount = await this.countMarkdownFiles(this.discussionPath)

    if (
      this.repository.countActivePersistentItems() > 0 &&
      persistentFileCount < this.repository.countActivePersistentItems()
    ) {
      missingNamespaces.push('memory_persistent')
    }

    if (
      this.repository.countDailySummaryItems() > 0 &&
      dailyFileCount < this.repository.countDailySummaryItems()
    ) {
      missingNamespaces.push('memory_daily')
    }

    if (
      this.repository.countActiveDiscussionDays() > 0 &&
      discussionFileCount < this.repository.countActiveDiscussionDays()
    ) {
      missingNamespaces.push('memory_discussion')
    }

    return missingNamespaces
  }

  private async repairMissingMemoryMirrors(reason: 'migration' | 'self_recovery'): Promise<KnowledgeNamespace[]> {
    const missingNamespaces = await this.detectMissingMirrorNamespaces()
    if (missingNamespaces.length === 0) {
      return []
    }

    const repairedNamespaces: KnowledgeNamespace[] = []
    let persistentRepaired = 0
    let dailyRepaired = 0
    let discussionRepaired = 0

    if (missingNamespaces.includes('memory_persistent')) {
      persistentRepaired = await this.rebuildMissingPersistentMirrors()
      if (persistentRepaired > 0) {
        repairedNamespaces.push('memory_persistent')
      }
    }

    if (missingNamespaces.includes('memory_daily')) {
      dailyRepaired = await this.rebuildMissingDailySummaryMirrors()
      if (dailyRepaired > 0) {
        repairedNamespaces.push('memory_daily')
      }
    }

    if (missingNamespaces.includes('memory_discussion')) {
      discussionRepaired = await this.rebuildMissingDiscussionMirrors()
      if (discussionRepaired > 0) {
        repairedNamespaces.push('memory_discussion')
      }
    }

    if (repairedNamespaces.length > 0) {
      LogHelper.title('Memory Manager')
      LogHelper.warning(
        `Recovered missing memory mirrors (${reason}): persistent=${persistentRepaired} daily=${dailyRepaired} discussion_days=${discussionRepaired}`
      )
    }

    return repairedNamespaces
  }

  private async ensureMemoryMirrorIntegrity(): Promise<void> {
    const recoveryState = await this.loadRecoveryState()
    let repairedNamespaces: KnowledgeNamespace[] = []

    if (
      !recoveryState.completedMigrations.includes(
        MEMORY_MIRROR_RECOVERY_MIGRATION_ID
      )
    ) {
      repairedNamespaces = await this.repairMissingMemoryMirrors('migration')
      recoveryState.completedMigrations = [
        ...new Set([
          ...recoveryState.completedMigrations,
          MEMORY_MIRROR_RECOVERY_MIGRATION_ID
        ])
      ]
      await this.saveRecoveryState(recoveryState)
    }

    if (repairedNamespaces.length === 0) {
      repairedNamespaces = await this.repairMissingMemoryMirrors('self_recovery')
    }

    if (repairedNamespaces.length === 0) {
      return
    }

    for (const namespace of repairedNamespaces) {
      this.qmdBackend.markDirty(namespace)
    }

    await this.qmdBackend.refresh(true)
  }

  private normalizeForSimilarity(text: string): string {
    return normalizeContent(text)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  private tokenizeForSimilarity(text: string): string[] {
    return this.normalizeForSimilarity(text)
      .split(' ')
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  }

  private tokenJaccardSimilarity(tokensA: string[], tokensB: string[]): number {
    if (tokensA.length === 0 || tokensB.length === 0) {
      return 0
    }

    const setA = new Set(tokensA)
    const setB = new Set(tokensB)
    let intersectionSize = 0

    for (const token of setA) {
      if (setB.has(token)) {
        intersectionSize += 1
      }
    }

    const unionSize = setA.size + setB.size - intersectionSize
    if (unionSize <= 0) {
      return 0
    }

    return intersectionSize / unionSize
  }

  private isNearDuplicatePersistentContent(
    candidate: string,
    existing: string
  ): boolean {
    const normalizedCandidate = this.normalizeForSimilarity(candidate)
    const normalizedExisting = this.normalizeForSimilarity(existing)
    if (!normalizedCandidate || !normalizedExisting) {
      return false
    }

    if (normalizedCandidate === normalizedExisting) {
      return true
    }

    const shorter = normalizedCandidate.length <= normalizedExisting.length
      ? normalizedCandidate
      : normalizedExisting
    const longer = shorter === normalizedCandidate
      ? normalizedExisting
      : normalizedCandidate

    if (
      shorter.length >= PERSISTENT_SIMILARITY_CONTAINMENT_MIN_CHARS &&
      longer.includes(shorter)
    ) {
      return true
    }

    const candidateTokens = this.tokenizeForSimilarity(normalizedCandidate)
    const existingTokens = this.tokenizeForSimilarity(normalizedExisting)
    if (candidateTokens.length < 4 || existingTokens.length < 4) {
      return false
    }

    return (
      this.tokenJaccardSimilarity(candidateTokens, existingTokens) >=
      PERSISTENT_SIMILARITY_JACCARD_THRESHOLD
    )
  }

  private async shouldSkipSimilarPersistentCandidate(
    candidate: string
  ): Promise<boolean> {
    const existingContents = this.repository.listRecentPersistentContents(
      PERSISTENT_SIMILARITY_LOOKBACK
    )

    for (const existingContent of existingContents) {
      if (this.isNearDuplicatePersistentContent(candidate, existingContent)) {
        const preview = existingContent.length > 200
          ? `${existingContent.slice(0, 200)}...`
          : existingContent
        LogHelper.title('Memory Manager')
        LogHelper.debug(
          `Skipped persistent candidate due to similarity with existing memory: ${JSON.stringify(
            preview
          )}`
        )
        return true
      }
    }

    return false
  }

  public constructor() {
    if (!MemoryManager.instance) {
      LogHelper.title('Memory Manager')
      LogHelper.success('New instance')
      MemoryManager.instance = this
    }
  }

  public get isLoaded(): boolean {
    return this._isLoaded
  }

  public async load(): Promise<void> {
    if (this._isLoaded) {
      return
    }

    try {
      await Promise.all([
        fs.promises.mkdir(this.persistentPath, { recursive: true }),
        fs.promises.mkdir(this.dailyPath, { recursive: true }),
        fs.promises.mkdir(this.discussionPath, { recursive: true })
      ])

      await this.repository.load(PROFILE_MEMORY_DB_PATH)
      await this.ensureMemoryMirrorIntegrity()

      this._isLoaded = true
      this.scheduleContextSyncAtBoot()
      this.requestStorageMaintenance(Date.now())
      LogHelper.title('Memory Manager')
      LogHelper.success('Loaded')
    } catch (e) {
      LogHelper.title('Memory Manager')
      LogHelper.error(`Failed to load: ${e}`)
    }
  }

  public shouldRecallForQuery(query: string): boolean {
    const terms = (String(query || '').toLowerCase().match(/[a-z0-9_]+/g) || [])
      .map((term) => term.trim())
      .filter((term) => term.length >= 2)

    return terms.length >= RECALL_MIN_QUERY_TERMS
  }

  public async remember(input: MemoryWriteInput): Promise<MemoryRecord> {
    if (!this._isLoaded) {
      await this.load()
    }

    const normalizedContent = normalizeContent(input.content)
    const now = Date.now()
    const dedupeHash = computeHash(
      `${input.scope}|${input.kind}|${normalizedContent.toLowerCase()}`
    )

    const saved = this.repository.upsertMemoryItem(
      {
        ...input,
        content: normalizedContent
      },
      dedupeHash,
      now,
      () => randomUUID()
    )

    if (saved.scope === 'persistent') {
      const filePath = this.getPersistentEntryFilePath(saved.id, saved.createdAt)
      const markdown = `> Persistent memory entry (${saved.kind})\n\n# ${saved.title || saved.kind}\n\nID: ${saved.id}\nCreated At: ${new Date(saved.createdAt).toISOString()}\n\n${saved.content}\n`
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
      await fs.promises.writeFile(filePath, markdown, 'utf8')
      this.qmdBackend.markDirty('memory_persistent')
    }

    if (saved.scope === 'daily' && saved.kind === 'summary' && saved.dayKey) {
      const filePath = path.join(this.dailyPath, `${saved.dayKey}.md`)
      await fs.promises.writeFile(filePath, saved.content, 'utf8')
      this.qmdBackend.markDirty('memory_daily')
    }

    if (saved.scope === 'discussion' && saved.dayKey) {
      const dayDiscussionPath = path.join(this.discussionPath, `${saved.dayKey}.md`)
      const discussionHeader = `> Discussion memory for ${saved.dayKey}. Short-term rolling conversation context.\n# ${saved.dayKey}\n\n`
      const line = `- ${new Date(saved.createdAt).toISOString()} | ${saved.content.replace(/\n/g, ' | ')}\n`

      if (!fs.existsSync(dayDiscussionPath)) {
        await fs.promises.writeFile(dayDiscussionPath, `${discussionHeader}${line}`, 'utf8')
      } else {
        await fs.promises.appendFile(dayDiscussionPath, line, 'utf8')
      }

      this.qmdBackend.markDirty('memory_discussion')
    }

    return saved
  }

  public async rememberExplicit(
    text: string,
    metadata: Record<string, unknown> = {}
  ): Promise<MemoryRecord> {
    return this.remember({
      scope: 'persistent',
      kind: 'note',
      title: 'Explicit memory',
      content: text,
      sourceType: 'explicit_user',
      importance: 0.95,
      confidence: 0.95,
      metadata
    })
  }

  public async forgetById(id: string): Promise<boolean> {
    if (!this._isLoaded) {
      await this.load()
    }

    return this.repository.softDeleteById(id)
  }

  public async forgetByQuery(query: string): Promise<number> {
    if (!this._isLoaded) {
      await this.load()
    }

    const normalizedQuery = normalizeContent(query)
    if (!normalizedQuery) {
      return 0
    }

    return this.repository.softDeleteByQuery(normalizedQuery)
  }

  public async recall(input: RecallQuery): Promise<RecallResult> {
    if (!this._isLoaded) {
      await this.load()
    }

    const topK = input.topK || LEON_MEMORY_RECALL_TOP_K
    const tokenBudget = input.tokenBudget || LEON_MEMORY_EXECUTION_TOKEN_BUDGET
    const namespaces = this.normalizeRecallNamespaces(input.namespaces)

    if (!input.skipContextSync && namespaces.includes('context')) {
      await this.syncContextFiles()
    }

    LogHelper.title('Memory Manager')
    LogHelper.debug(
      `Recall query="${input.query}" | namespaces=${namespaces.join(', ')} | context_files=${
        input.contextFilenames && input.contextFilenames.length > 0
          ? input.contextFilenames.join(', ')
          : 'all'
      } | topK=${topK} | token_budget=${tokenBudget} | retrieval_mode=${
        input.retrievalMode || 'hybrid'
      }`
    )

    const qmdHits = await this.qmdBackend.query({
      query: input.query,
      namespaces,
      topK,
      ...(input.retrievalMode ? { retrievalMode: input.retrievalMode } : {}),
      ...(input.contextFilenames && input.contextFilenames.length > 0
        ? { contextFilenames: input.contextFilenames }
        : {})
    })

    const hits: RecallHit[] = qmdHits.map((hit, index) => ({
      chunkId: hit.id || `${hit.namespace}:${index}`,
      itemId: hit.path || hit.id,
      namespace: hit.namespace,
      scope:
        hit.namespace === 'memory_persistent'
          ? 'persistent'
          : hit.namespace === 'memory_daily'
            ? 'daily'
            : hit.namespace === 'memory_discussion'
              ? 'discussion'
              : null,
      kind: null,
      title: hit.title || path.basename(hit.path || '') || null,
      content: normalizeContent(hit.content),
      bm25Score: hit.score,
      createdAt: Date.now(),
      sourcePath: hit.path || null
    }))

    const queryTokens = new Set(tokenizeWords(input.query))
    const contextFilenameBoost = (hit: RecallHit): number => {
      if (hit.namespace !== 'context') {
        return 0
      }

      const sourceLabel = hit.sourcePath
        ? path.basename(hit.sourcePath)
        : hit.title || ''
      const filenameTokens = tokenizeFilenameWords(sourceLabel)
      if (filenameTokens.length === 0) {
        return 0
      }

      const matchedCount = filenameTokens.filter((token) =>
        queryTokens.has(token)
      ).length
      if (matchedCount === 0) {
        return 0
      }

      return (matchedCount / filenameTokens.length) * 0.8
    }

    hits.sort((a, b) => {
      const aScore =
        a.bm25Score * namespaceRecallWeight(a.namespace) +
        contextFilenameBoost(a)
      const bScore =
        b.bm25Score * namespaceRecallWeight(b.namespace) +
        contextFilenameBoost(b)
      if (aScore !== bScore) {
        return bScore - aScore
      }

      return b.bm25Score - a.bm25Score
    })

    LogHelper.title('Memory Manager')
    LogHelper.debug(`Recall candidates: ${hits.length}`)
    if (hits.length > 0) {
      const namespaceCounts = hits.reduce<Record<string, number>>((acc, hit) => {
        acc[hit.namespace] = (acc[hit.namespace] || 0) + 1
        return acc
      }, {})
      LogHelper.debug(
        `Recall candidates by namespace: ${Object.entries(namespaceCounts)
          .map(([namespace, count]) => `${namespace}=${count}`)
          .join(', ')}`
      )
    }

    const facts = input.includeFacts
      ? this.repository.getFactsTop(8)
      : []

    const selectedHits: RecallHit[] = []
    const selectedChunkIds = new Set<string>()
    const selectedContentHashes = new Set<string>()
    const partiallySharedChunkIds = new Set<string>()
    let usedTokenEstimate = 0
    let hasSelectedContext = false

    const fitHitToBudget = (
      hit: RecallHit,
      remainingBudget: number,
      allowTruncate: boolean
    ): { fittedHit: RecallHit, tokens: number, truncated: boolean } | null => {
      if (remainingBudget <= 0) {
        return null
      }

      const fullEstimate = Math.max(1, Math.ceil(hit.content.length / 4))
      if (fullEstimate <= remainingBudget) {
        return {
          fittedHit: hit,
          tokens: fullEstimate,
          truncated: false
        }
      }

      if (!allowTruncate || remainingBudget < MIN_TRUNCATED_RECALL_TOKENS) {
        return null
      }

      const truncatedTokenBudget = Math.max(
        MIN_TRUNCATED_RECALL_TOKENS,
        Math.min(
          remainingBudget,
          Math.floor(tokenBudget * TRUNCATED_RECALL_BUDGET_RATIO)
        )
      )
      if (truncatedTokenBudget > remainingBudget) {
        return null
      }

      const maxChars = truncatedTokenBudget * 4
      const truncatedContent =
        hit.content.length > maxChars
          ? `${hit.content.slice(0, maxChars).trimEnd()}...`
          : hit.content
      const truncatedEstimate = Math.max(
        1,
        Math.ceil(truncatedContent.length / 4)
      )

      return {
        fittedHit: {
          ...hit,
          content: truncatedContent
        },
        tokens: truncatedEstimate,
        truncated: true
      }
    }

    const hasPersistentCandidates = hits.some(
      (hit) => hit.namespace === 'memory_persistent'
    )
    const shouldSeedContextFirst =
      namespaces.includes('context') &&
      (
        (input.contextFilenames && input.contextFilenames.length > 0) ||
        !hasPersistentCandidates
      )
    const topContextCandidate = shouldSeedContextFirst
      ? hits.find((hit) => hit.namespace === 'context')
      : undefined
    if (topContextCandidate) {
      const contextSeed = fitHitToBudget(
        topContextCandidate,
        tokenBudget - usedTokenEstimate,
        true
      )
      if (contextSeed) {
        selectedHits.push(contextSeed.fittedHit)
        selectedChunkIds.add(topContextCandidate.chunkId)
        selectedContentHashes.add(
          computeHash(
            normalizeContent(contextSeed.fittedHit.content).toLowerCase()
          )
        )
        usedTokenEstimate += contextSeed.tokens
        hasSelectedContext = true
        if (contextSeed.truncated) {
          partiallySharedChunkIds.add(topContextCandidate.chunkId)
        }
        if (contextSeed.truncated) {
          LogHelper.title('Memory Manager')
          LogHelper.debug(
            `Recall context seed truncated: source="${topContextCandidate.sourcePath || topContextCandidate.title || topContextCandidate.namespace}" tokens=${contextSeed.tokens}`
          )
        }
      }
    }

    const topPersistentCandidate = hits.find(
      (candidate) => candidate.namespace === 'memory_persistent'
    )
    if (topPersistentCandidate && !selectedChunkIds.has(topPersistentCandidate.chunkId)) {
      const remainingBudget = tokenBudget - usedTokenEstimate
      const persistentSeed = fitHitToBudget(topPersistentCandidate, remainingBudget, true)
      if (persistentSeed) {
        selectedHits.push(persistentSeed.fittedHit)
        selectedChunkIds.add(topPersistentCandidate.chunkId)
        selectedContentHashes.add(
          computeHash(
            normalizeContent(persistentSeed.fittedHit.content).toLowerCase()
          )
        )
        usedTokenEstimate += persistentSeed.tokens
        if (persistentSeed.truncated) {
          partiallySharedChunkIds.add(topPersistentCandidate.chunkId)
        }
        if (persistentSeed.truncated) {
          LogHelper.title('Memory Manager')
          LogHelper.debug(
            `Recall persistent seed truncated: source="${topPersistentCandidate.sourcePath || topPersistentCandidate.title || topPersistentCandidate.namespace}" tokens=${persistentSeed.tokens}`
          )
        }
      }
    }

    for (const hit of hits) {
      if (selectedHits.length >= topK) {
        break
      }
      if (selectedChunkIds.has(hit.chunkId)) {
        continue
      }
      const candidateHash = computeHash(normalizeContent(hit.content).toLowerCase())
      if (selectedContentHashes.has(candidateHash)) {
        continue
      }
      const remainingBudget = tokenBudget - usedTokenEstimate
      const allowTruncate =
        selectedHits.length === 0 ||
        (hit.namespace === 'context' && !hasSelectedContext) ||
        hit.namespace === 'memory_persistent'
      const fitted = fitHitToBudget(hit, remainingBudget, allowTruncate)
      if (!fitted) {
        continue
      }
      selectedHits.push(fitted.fittedHit)
      selectedChunkIds.add(hit.chunkId)
      selectedContentHashes.add(
        computeHash(normalizeContent(fitted.fittedHit.content).toLowerCase())
      )
      usedTokenEstimate += fitted.tokens
      if (fitted.truncated) {
        partiallySharedChunkIds.add(hit.chunkId)
      }
      if (fitted.fittedHit.namespace === 'context') {
        hasSelectedContext = true
      }
      if (fitted.truncated) {
        LogHelper.title('Memory Manager')
        LogHelper.debug(
          `Recall selected truncated hit: source="${hit.sourcePath || hit.title || hit.namespace}" truncated_tokens=${fitted.tokens}`
        )
      }
    }

    LogHelper.title('Memory Manager')
    LogHelper.debug(
      `Recall selected: ${selectedHits.length} | used_tokens=${usedTokenEstimate}`
    )
    for (const [index, hit] of selectedHits.entries()) {
      const sourceLabel = hit.sourcePath
        ? path.basename(hit.sourcePath)
        : hit.title || hit.namespace
      const preview = hit.content.length > 280
        ? `${hit.content.slice(0, 280)}...`
        : hit.content
      const weightedScore = hit.bm25Score * namespaceRecallWeight(hit.namespace)
      LogHelper.debug(
        `Recall selected[${index + 1}] source="${sourceLabel}" namespace=${hit.namespace} score=${hit.bm25Score.toFixed(4)} weighted=${weightedScore.toFixed(4)} content=${JSON.stringify(preview)}`
      )
      LogHelper.debug(
        `Memory ${partiallySharedChunkIds.has(hit.chunkId) ? 'partially shared' : 'fully shared'}: source="${sourceLabel}" namespace=${hit.namespace} value=${JSON.stringify(
          hit.content
        )}`
      )
    }

    if (facts.length > 0) {
      for (const [index, fact] of facts.entries()) {
        LogHelper.debug(
          `Memory fully shared: source="fact:${index + 1}" namespace=fact value=${JSON.stringify(
            fact.text
          )}`
        )
      }
    }

    const result: RecallResult = {
      hits: selectedHits,
      facts,
      promptText: '',
      usedTokenEstimate
    }
    result.promptText = renderRecallPrompt(result)

    return result
  }

  private normalizeRecallNamespaces(
    namespaces?: string[]
  ): RecallHit['namespace'][] {
    const allowed = new Set<RecallHit['namespace']>([
      'memory_persistent',
      'memory_daily',
      'memory_discussion',
      'conversation_daily',
      'context'
    ])
    const normalized = Array.isArray(namespaces)
      ? namespaces.filter(
          (namespace): namespace is RecallHit['namespace'] =>
            typeof namespace === 'string' &&
            namespace !== 'default' &&
            allowed.has(namespace as RecallHit['namespace'])
        )
      : []

    return normalized.length > 0
      ? [...new Set(normalized)]
      : ['memory_persistent', 'memory_daily', 'memory_discussion', 'context']
  }

  public async buildPlanningMemoryPack(
    query: string,
    tokenBudget = LEON_MEMORY_PLANNING_TOKEN_BUDGET
  ): Promise<string> {
    if (!this.shouldRecallForQuery(query)) {
      return ''
    }

    const recalled = await this.recall({
      query,
      namespaces: [
        'memory_persistent',
        'memory_daily',
        'memory_discussion'
      ],
      topK: LEON_MEMORY_PLANNING_RECALL_TOP_K,
      tokenBudget,
      includeFacts: true,
      skipContextSync: true,
      retrievalMode: 'lexical'
    })

    if (!recalled.hits.length && !recalled.facts.length) {
      return ''
    }

    LogHelper.title('Memory Manager')
    LogHelper.debug(
      `Planning memory pack built | chars=${recalled.promptText.length} | used_tokens=${recalled.usedTokenEstimate}`
    )

    return recalled.promptText
  }

  public async buildExecutionMemoryPack(
    query: string,
    _toolkitId: string,
    contextFiles: string[] = [],
    tokenBudget = LEON_MEMORY_EXECUTION_TOKEN_BUDGET
  ): Promise<string> {
    if (!this.shouldRecallForQuery(query)) {
      return ''
    }

    const normalizedContextFiles = [...new Set(contextFiles)]
    const includeContext = normalizedContextFiles.length > 0

    const recalled = await this.recall({
      query,
      namespaces: includeContext
        ? ['memory_persistent', 'memory_discussion', 'context']
        : ['memory_persistent', 'memory_discussion'],
      contextFilenames: includeContext ? normalizedContextFiles : [],
      topK: LEON_MEMORY_RECALL_TOP_K,
      tokenBudget,
      includeFacts: true
    })

    if (!recalled.hits.length && !recalled.facts.length) {
      return ''
    }

    LogHelper.title('Memory Manager')
    LogHelper.debug(
      `Execution memory pack built | toolkit=${_toolkitId} | context_files=${
        normalizedContextFiles.length > 0
          ? normalizedContextFiles.join(', ')
          : 'none'
      } | chars=${recalled.promptText.length} | used_tokens=${recalled.usedTokenEstimate}`
    )

    return recalled.promptText
  }

  public async observeTurn(input: TurnObservationInput): Promise<void> {
    if (!this._isLoaded) {
      await this.load()
    }

    this.qmdBackend.enableHybridRetrieval()

    const userMessage = normalizeContent(input.userMessage)
    const assistantMessage = normalizeContent(input.assistantMessage)
    if (!userMessage && !assistantMessage) {
      return
    }

    const now = input.sentAt || Date.now()
    const dayKey = toDayKey(now)
    const pairedContent = `Owner: ${userMessage}\nLeon: ${assistantMessage}`

    await this.remember({
      scope: 'daily',
      kind: 'event',
      title: 'Conversation event',
      content: pairedContent,
      sourceType: 'conversation',
      sourceRef: `turn:${now}`,
      dayKey,
      importance: 0.55,
      confidence: 0.85,
      metadata: {
        route: input.route
      }
    })

    await this.remember({
      scope: 'discussion',
      kind: 'note',
      title: 'Recent discussion',
      content: pairedContent,
      sourceType: 'conversation',
      sourceRef: `turn:${now}`,
      dayKey,
      expiresAt: now + DISCUSSION_TTL_MS,
      importance: 0.45,
      confidence: 0.75,
      metadata: {
        route: input.route
      }
    })

    await this.summarizeDay(dayKey)
    await this.pruneDiscussion(now)
  }

  public async savePersistentMemoryCandidates(
    candidates: string[],
    sourceRef: string,
    nowTs = Date.now()
  ): Promise<number> {
    if (!this._isLoaded) {
      await this.load()
    }

    const normalizedCandidates = [...new Set(candidates)]
      .map((item) => normalizeContent(item))
      .filter((item) => item.length > 0)

    if (normalizedCandidates.length === 0) {
      return 0
    }

    let savedCount = 0
    const savedEntries: Array<{ filePath: string, content: string }> = []
    for (const candidate of normalizedCandidates) {
      if (await this.shouldSkipSimilarPersistentCandidate(candidate)) {
        continue
      }

      const saved = await this.remember({
        scope: 'persistent',
        kind: 'note',
        title: 'Persistent memory candidate',
        content: candidate,
        sourceType: 'explicit_user',
        sourceRef,
        importance: 0.95,
        confidence: 0.95,
        metadata: {
          saved_at: nowTs
        }
      })
      savedCount += 1
      savedEntries.push({
        filePath: this.getPersistentEntryFilePath(saved.id, saved.createdAt),
        content: saved.content
      })
    }

    LogHelper.title('Memory Manager')
    LogHelper.debug(
      `Persistent memory candidates saved: ${savedCount}`
    )
    for (const savedEntry of savedEntries) {
      LogHelper.debug(
        `Persistent memory file="${savedEntry.filePath}" content=${JSON.stringify(
          savedEntry.content
        )}`
      )
    }
    try {
      const dbStats = fs.statSync(PROFILE_MEMORY_DB_PATH)
      const persistentItemCount = this.repository.countActivePersistentItems()
      LogHelper.debug(
        `Memory index file="${PROFILE_MEMORY_DB_PATH}" size_bytes=${dbStats.size} persistent_items=${persistentItemCount}`
      )
    } catch {
      // Ignore stat errors for debug stats.
    }

    return savedCount
  }

  private extractJsonSubstring(input: string): string | null {
    const firstBrace = input.indexOf('{')
    const firstBracket = input.indexOf('[')
    const startIndex =
      firstBrace !== -1 && firstBracket !== -1
        ? Math.min(firstBrace, firstBracket)
        : Math.max(firstBrace, firstBracket)

    if (startIndex === -1) {
      return null
    }

    const endIndex =
      input[startIndex] === '{'
        ? input.lastIndexOf('}')
        : input.lastIndexOf(']')

    if (endIndex <= startIndex) {
      return null
    }

    return input.slice(startIndex, endIndex + 1)
  }

  private parsePersistentExtractionCandidates(output: unknown): string[] {
    const normalizeItems = (payload: unknown): string[] => {
      if (!payload || typeof payload !== 'object') {
        return []
      }

      const payloadObject = payload as Record<string, unknown>
      const items = Array.isArray(payloadObject['items'])
        ? (payloadObject['items'] as unknown[])
        : []

      return [...new Set(
        items
          .map((item) =>
            item && typeof item === 'object'
              ? String((item as Record<string, unknown>)['content'] || '').trim()
              : ''
          )
          .filter((content) => content.length > 0)
      )]
    }

    const objectCandidates = normalizeItems(output)
    if (objectCandidates.length > 0) {
      return objectCandidates
    }

    if (typeof output !== 'string') {
      return []
    }

    const rawOutput = output.trim()
    if (!rawOutput) {
      return []
    }

    const strippedCodeFence = rawOutput
      .replace(/^```(?:json)?\s*\n?/i, '')
      .replace(/\n?```\s*$/i, '')
      .trim()
    const extractedJson = this.extractJsonSubstring(strippedCodeFence)
    const parseCandidates = [
      rawOutput,
      strippedCodeFence,
      extractedJson
    ].filter((candidate): candidate is string => Boolean(candidate))

    if (
      strippedCodeFence.startsWith('{') &&
      !strippedCodeFence.endsWith('}')
    ) {
      parseCandidates.push(`${strippedCodeFence}}`)
    }

    for (const parseCandidate of parseCandidates) {
      try {
        const parsed = JSON.parse(parseCandidate)
        const parsedCandidates = normalizeItems(parsed)
        if (parsedCandidates.length > 0) {
          return parsedCandidates
        }
      } catch {
        // Continue fallback parsing
      }
    }

    const contentFieldMatches = [...strippedCodeFence.matchAll(
      /"content"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g
    )]
    const contentFieldCandidates = contentFieldMatches
      .map((match) => {
        const rawMatch = match[1]
        if (!rawMatch) {
          return ''
        }
        try {
          return JSON.parse(`"${rawMatch}"`) as string
        } catch {
          return rawMatch
        }
      })
      .map((candidate) => candidate.trim())
      .filter((candidate) => candidate.length > 0)
    if (contentFieldCandidates.length > 0) {
      return [...new Set(contentFieldCandidates)]
    }

    const lineCandidates = strippedCodeFence
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) =>
        line
          .replace(/^[-*]\s+/, '')
          .replace(/^\d+[.)]\s+/, '')
          .replace(/^["'`]+|["'`,]+$/g, '')
          .trim()
      )
      .filter((line) => line.length >= 8)
      .filter((line) => !/^items?:?$/i.test(line))
      .filter((line) => line !== '{' && line !== '}' && line !== '[' && line !== ']')

    return [...new Set(lineCandidates)]
  }

  private isExplicitEmptyPersistentExtractionPayload(
    output: unknown
  ): boolean {
    const hasExplicitEmptyItems = (payload: unknown): boolean => {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return false
      }

      const payloadObject = payload as Record<string, unknown>
      return (
        Array.isArray(payloadObject['items']) &&
        payloadObject['items'].length === 0
      )
    }

    if (hasExplicitEmptyItems(output)) {
      return true
    }

    if (typeof output !== 'string') {
      return false
    }

    const rawOutput = output.trim()
    if (!rawOutput) {
      return false
    }

    const strippedCodeFence = rawOutput
      .replace(/^```(?:json)?\s*\n?/i, '')
      .replace(/\n?```\s*$/i, '')
      .trim()
    const extractedJson = this.extractJsonSubstring(strippedCodeFence)
    const parseCandidates = [
      rawOutput,
      strippedCodeFence,
      extractedJson
    ].filter((candidate): candidate is string => Boolean(candidate))

    for (const parseCandidate of parseCandidates) {
      try {
        if (hasExplicitEmptyItems(JSON.parse(parseCandidate))) {
          return true
        }
      } catch {
        // Continue fallback parsing
      }
    }

    return false
  }

  public async savePersistentMemoryCandidatesFromTurn(
    userMessage: string,
    assistantMessage: string,
    sentAt: number
  ): Promise<number> {
    if (!this._isLoaded) {
      await this.load()
    }

    const normalizedUserMessage = truncateForExtraction(
      normalizeContent(userMessage),
      PERSISTENT_EXTRACTION_MAX_USER_CHARS
    )
    const normalizedAssistantMessage = truncateForExtraction(
      normalizeContent(assistantMessage),
      PERSISTENT_EXTRACTION_MAX_ASSISTANT_CHARS
    )

    if (
      !shouldAttemptPersistentExtraction(
        normalizedUserMessage,
        normalizedAssistantMessage
      )
    ) {
      LogHelper.title('Memory Manager')
      LogHelper.debug(
        'Persistent memory extraction skipped for low-signal turn'
      )
      return 0
    }

    const prompt = `Conversation turn:
User: ${normalizedUserMessage}
Leon: ${normalizedAssistantMessage}

Extract only durable personal memories worth persisting long-term.
Keep only stable user facts/preferences/commitments likely useful in future conversations.
Do not include temporary chat content.
Return strictly valid JSON with this exact shape:
{"items":[{"content":"..."}]}
No markdown. No explanation.`

    try {
      const { LLM_PROVIDER } = await import('@/core')
      const completion = await LLM_PROVIDER.prompt(prompt, {
        dutyType: LLMDuties.Inference,
        systemPrompt:
          'Extract stable long-term user memory candidates. Be strict and concise.',
        data: EXTRACT_PERSISTENT_MEMORY_SCHEMA,
        timeout: PERSISTENT_EXTRACTION_TIMEOUT_MS,
        maxRetries: PERSISTENT_EXTRACTION_MAX_RETRIES,
        maxTokens: PERSISTENT_EXTRACTION_MAX_TOKENS,
        trackProviderErrors: false,
        /**
         * Disable thinking when Llama.cpp since local models tend
         * to loop overthink
         */
        ...(CONFIG_STATE.getModelState().getWorkflowProvider() ===
        LLMProviders.LlamaCPP
          ? { disableThinking: true }
          : {})
      })

      if (!completion?.output) {
        LogHelper.title('Memory Manager')
        LogHelper.debug(
          `Persistent extraction diagnostics | output=${String(completion?.output)} | output_type=${typeof completion?.output}`
        )
        LogHelper.debug('Persistent memory extraction returned no output')
        return 0
      }

      const candidates = this.parsePersistentExtractionCandidates(
        completion.output
      ).slice(0, 3)
      const isExplicitEmptyPayload = this.isExplicitEmptyPersistentExtractionPayload(
        completion.output
      )
      if (candidates.length === 0) {
        const outputPreview =
          typeof completion.output === 'string'
            ? truncateForExtraction(
                normalizeContent(completion.output),
                360
              )
            : truncateForExtraction(
                normalizeContent(JSON.stringify(completion.output)),
                360
              )

        LogHelper.title('Memory Manager')
        LogHelper.debug(
          `Persistent extraction diagnostics | output_type=${typeof completion.output} | explicit_empty=${String(isExplicitEmptyPayload)} | preview=${JSON.stringify(outputPreview)}`
        )

        if (isExplicitEmptyPayload) {
          LogHelper.title('Memory Manager')
          LogHelper.debug(
            'Persistent memory extraction found no durable candidates'
          )
          return 0
        }

        LogHelper.title('Memory Manager')
        LogHelper.warning(
          'Persistent memory extraction returned invalid or empty payload'
        )
        return 0
      }

      const saved = await this.savePersistentMemoryCandidates(
        candidates,
        `turn:${sentAt}`,
        sentAt
      )

      LogHelper.title('Memory Manager')
      LogHelper.debug(
        `Persistent extraction diagnostics | candidates=${JSON.stringify(candidates)}`
      )
      LogHelper.debug(
        `Persistent memory candidates extracted and saved: ${saved}`
      )

      return saved
    } catch (error) {
      LogHelper.title('Memory Manager')
      LogHelper.warning(`Persistent memory extraction skipped: ${error}`)
      return 0
    }
  }

  public async summarizeDay(dayKey: string): Promise<void> {
    if (!this._isLoaded) {
      await this.load()
    }

    const now = Date.now()
    const queuedSummary = this.dailySummaryQueue.get(dayKey)
    if (
      queuedSummary &&
      now - queuedSummary.startedAt > DAILY_SUMMARY_QUEUE_STALE_MS
    ) {
      LogHelper.title('Memory Manager')
      LogHelper.warning(
        `Daily summary queue reset for day=${dayKey} after ${Math.round(
          (now - queuedSummary.startedAt) / 1_000
        )}s stall`
      )
      this.dailySummaryQueue.delete(dayKey)
    }

    const previous = this.dailySummaryQueue.get(dayKey)?.promise || Promise.resolve()
    const current = previous
      .catch(() => undefined)
      .then(() => this.summarizeDayInternal(dayKey))

    this.dailySummaryQueue.set(dayKey, {
      promise: current,
      startedAt: now
    })
    try {
      await current
    } finally {
      if (this.dailySummaryQueue.get(dayKey)?.promise === current) {
        this.dailySummaryQueue.delete(dayKey)
      }
    }
  }

  private async summarizeDayInternal(dayKey: string): Promise<void> {
    const entries = this.repository.getDailyConversationLogs(dayKey)
    const messageLogs = entries.flatMap((entry) =>
      parseConversationPair(entry.content).map((parsed) => ({
        who: parsed.who,
        message: parsed.message,
        sentAt: Date.now(),
        isAddedToHistory: true
      }))
    )

    const summaryMarkdown = buildDailyMarkdownSummary(dayKey, messageLogs)
    const summaryPath = path.join(this.dailyPath, `${dayKey}.md`)
    await fs.promises.writeFile(summaryPath, summaryMarkdown, 'utf8')

    const existingSummary = this.repository.getDailySummaryItem(dayKey)
    const summaryInput: MemoryWriteInput = {
      scope: 'daily',
      kind: 'summary',
      title: `Daily summary ${dayKey}`,
      content: summaryMarkdown,
      sourceType: 'system',
      sourceRef: `daily-summary:${dayKey}`,
      dayKey,
      importance: 0.7,
      confidence: 0.85,
      metadata: {
        daily_summary: true
      }
    }

    if (existingSummary?.id) {
      summaryInput.supersedesItemId = existingSummary.id
    }

    await this.remember(summaryInput)

    let fileSize = 0
    let fileMtime = ''
    try {
      const stats = await fs.promises.stat(summaryPath)
      fileSize = stats.size
      fileMtime = stats.mtime.toISOString()
    } catch {
      // Ignore stat read issues for debug log.
    }

    LogHelper.title('Memory Manager')
    LogHelper.debug(
      `Daily memory summary updated: day=${dayKey} file="${summaryPath}" entries=${entries.length} chars=${summaryMarkdown.length} size_bytes=${fileSize} mtime=${fileMtime || 'unknown'}`
    )
  }

  public async pruneDiscussion(nowTs = Date.now()): Promise<number> {
    if (!this._isLoaded) {
      await this.load()
    }

    const deleted = this.repository.markDiscussionExpired(nowTs)
    this.requestStorageMaintenance(nowTs)
    return deleted
  }

  private scheduleContextSyncAtBoot(): void {
    setImmediate(() => {
      this.syncContextFiles(true).catch((error) => {
        LogHelper.title('Memory Manager')
        LogHelper.warning(`Background context sync failed: ${error}`)
      })
    })
  }

  private requestStorageMaintenance(nowTs = Date.now()): void {
    if (this.isStorageMaintenanceRunning) {
      this.storageMaintenanceQueued = true
      return
    }

    this.isStorageMaintenanceRunning = true
    setImmediate(() => {
      this.runStorageMaintenance(nowTs)
        .catch((error) => {
          LogHelper.title('Memory Manager')
          LogHelper.warning(`Background storage maintenance failed: ${error}`)
        })
        .finally(() => {
          this.isStorageMaintenanceRunning = false
          if (this.storageMaintenanceQueued) {
            this.storageMaintenanceQueued = false
            this.requestStorageMaintenance(Date.now())
          }
        })
    })
  }

  public async syncContextFiles(force = false): Promise<void> {
    if (!this._isLoaded && !force) {
      await this.load()
      return
    }

    const now = Date.now()
    if (!force && now - this.lastContextSyncAt < CONTEXT_SYNC_TTL_MS) {
      return
    }

    try {
      await fs.promises.mkdir(PROFILE_CONTEXT_PATH, { recursive: true })
      const entries = await fs.promises.readdir(PROFILE_CONTEXT_PATH, {
        withFileTypes: true
      })

      const markdownFiles = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map((entry) => path.join(PROFILE_CONTEXT_PATH, entry.name))

      let hasChanges = force
      const livePaths = new Set<string>()
      for (const filePath of markdownFiles) {
        livePaths.add(filePath)
        const content = await fs.promises.readFile(filePath, 'utf8')
        const checksum = computeHash(content)
        const previousChecksum = this.contextChecksums.get(filePath)

        if (previousChecksum !== checksum) {
          this.contextChecksums.set(filePath, checksum)
          hasChanges = true
        }
      }

      for (const trackedPath of [...this.contextChecksums.keys()]) {
        if (!livePaths.has(trackedPath)) {
          this.contextChecksums.delete(trackedPath)
          hasChanges = true
        }
      }

      if (hasChanges) {
        this.qmdBackend.markDirty('context')
      }

      this.lastContextSyncAt = now
    } catch (e) {
      LogHelper.title('Memory Manager')
      LogHelper.warning(`Failed to sync context files: ${e}`)
    }
  }

  private async getPathSize(targetPath: string): Promise<number> {
    try {
      const stats = await fs.promises.stat(targetPath)
      if (stats.isFile()) {
        return stats.size
      }
      if (!stats.isDirectory()) {
        return 0
      }
    } catch {
      return 0
    }

    let total = 0
    const pendingDirs = [targetPath]

    while (pendingDirs.length > 0) {
      const currentDir = pendingDirs.pop()
      if (!currentDir) {
        continue
      }

      let entries: fs.Dirent[] = []
      try {
        entries = await fs.promises.readdir(currentDir, { withFileTypes: true })
      } catch {
        continue
      }

      for (const entry of entries) {
        const entryPath = path.join(currentDir, entry.name)
        if (entry.isDirectory()) {
          pendingDirs.push(entryPath)
          continue
        }
        if (!entry.isFile()) {
          continue
        }
        try {
          total += (await fs.promises.stat(entryPath)).size
        } catch {
          // Ignore file-level stat errors during maintenance snapshots.
        }
      }
    }

    return total
  }

  private async captureStorageSnapshot(): Promise<StorageSnapshot> {
    const [
      memoryDbBytes,
      qmdDbBytes,
      persistentBytes,
      dailyBytes,
      discussionBytes,
      discussionWarmArchiveBytes,
      discussionColdArchiveBytes
    ] = await Promise.all([
      this.getPathSize(PROFILE_MEMORY_DB_PATH),
      this.getPathSize(this.qmdIndexPath),
      this.getPathSize(this.persistentPath),
      this.getPathSize(this.dailyPath),
      this.getPathSize(this.discussionPath),
      this.getPathSize(this.discussionWarmArchivePath),
      this.getPathSize(this.discussionColdArchivePath)
    ])

    return {
      memoryDbBytes,
      qmdDbBytes,
      persistentBytes,
      dailyBytes,
      discussionBytes,
      discussionWarmArchiveBytes,
      discussionColdArchiveBytes
    }
  }

  private async writeMonthlyMaintenanceReport(input: {
    nowTs: number
    before: StorageSnapshot
    after: StorageSnapshot
    discussionRetentionDeleted: number
    dailyRetentionDeleted: number
    warmArchived: number
    coldArchived: number
    warmCompactedToCold: number
    removedPersistentMirrorFiles: number
    purgedRows: number
  }): Promise<void> {
    const reportDate = new Date(input.nowTs)
    const monthKey = reportDate.toISOString().slice(0, 7)
    const reportPath = path.join(this.reportsPath, `maintenance-${monthKey}.jsonl`)
    await fs.promises.mkdir(this.reportsPath, { recursive: true })

    const payload = {
      at: reportDate.toISOString(),
      before: input.before,
      after: input.after,
      delta: {
        memoryDbBytes: input.after.memoryDbBytes - input.before.memoryDbBytes,
        qmdDbBytes: input.after.qmdDbBytes - input.before.qmdDbBytes,
        persistentBytes: input.after.persistentBytes - input.before.persistentBytes,
        dailyBytes: input.after.dailyBytes - input.before.dailyBytes,
        discussionBytes: input.after.discussionBytes - input.before.discussionBytes,
        discussionWarmArchiveBytes:
          input.after.discussionWarmArchiveBytes -
          input.before.discussionWarmArchiveBytes,
        discussionColdArchiveBytes:
          input.after.discussionColdArchiveBytes -
          input.before.discussionColdArchiveBytes
      },
      maintenance: {
        discussionRetentionDeleted: input.discussionRetentionDeleted,
        dailyRetentionDeleted: input.dailyRetentionDeleted,
        discussionArchivedWarm: input.warmArchived,
        discussionArchivedCold: input.coldArchived,
        discussionWarmCompactedToCold: input.warmCompactedToCold,
        persistentMirrorFilesRemoved: input.removedPersistentMirrorFiles,
        purgedRows: input.purgedRows
      }
    }

    await fs.promises.appendFile(reportPath, `${JSON.stringify(payload)}\n`, 'utf8')
  }

  private async runStorageMaintenance(nowTs: number): Promise<void> {
    if (nowTs - this.lastStorageMaintenanceAt < STORAGE_MAINTENANCE_INTERVAL_MS) {
      return
    }

    try {
      const beforeSnapshot = await this.captureStorageSnapshot()
      const discussionRetentionCutoffTs =
        nowTs - DISCUSSION_ACTIVE_RETENTION_DAYS * DAY_MS
      const discussionColdArchiveCutoffTs =
        nowTs - DISCUSSION_COLD_ARCHIVE_AFTER_DAYS * DAY_MS
      const dailyRetentionCutoffTs = nowTs - DAILY_FULL_RETENTION_DAYS * DAY_MS
      const softDeleteRetentionCutoffTs = nowTs - SOFT_DELETED_RETENTION_MS

      const discussionRetentionDeleted = this.repository.softDeleteDiscussionOlderThan(
        discussionRetentionCutoffTs,
        nowTs
      )
      const dailyRetentionDeleted = this.repository.softDeleteDailyNonSummaryOlderThan(
        dailyRetentionCutoffTs,
        nowTs
      )
      const discussionArchiveStats = await this.rotateDiscussionMarkdownFiles(
        discussionRetentionCutoffTs,
        discussionColdArchiveCutoffTs
      )
      const persistentMirrorCleanupCandidates =
        this.repository.listSoftDeletedPersistentEntries(
          softDeleteRetentionCutoffTs
        )
      const purged = this.repository.purgeSoftDeleted(
        softDeleteRetentionCutoffTs
      )
      const removedPersistentMirrorFiles = await this.removePersistentMirrorFiles(
        persistentMirrorCleanupCandidates
      )

      if (
        discussionRetentionDeleted > 0 ||
        discussionArchiveStats.warmArchived > 0 ||
        discussionArchiveStats.coldArchived > 0 ||
        discussionArchiveStats.warmCompactedToCold > 0
      ) {
        this.qmdBackend.markDirty('memory_discussion')
      }

      if (dailyRetentionDeleted > 0) {
        this.qmdBackend.markDirty('memory_daily')
      }

      if (removedPersistentMirrorFiles > 0) {
        this.qmdBackend.markDirty('memory_persistent')
      }

      this.repository.optimizeStorage()
      const afterSnapshot = await this.captureStorageSnapshot()
      await this.writeMonthlyMaintenanceReport({
        nowTs,
        before: beforeSnapshot,
        after: afterSnapshot,
        discussionRetentionDeleted,
        dailyRetentionDeleted,
        warmArchived: discussionArchiveStats.warmArchived,
        coldArchived: discussionArchiveStats.coldArchived,
        warmCompactedToCold: discussionArchiveStats.warmCompactedToCold,
        removedPersistentMirrorFiles,
        purgedRows: purged
      })
      this.lastStorageMaintenanceAt = nowTs

      LogHelper.title('Memory Manager')
      LogHelper.info(
        `Storage maintenance completed: discussion_deleted=${discussionRetentionDeleted} daily_deleted=${dailyRetentionDeleted} discussion_archived_warm=${discussionArchiveStats.warmArchived} discussion_archived_cold=${discussionArchiveStats.coldArchived} discussion_warm_compacted=${discussionArchiveStats.warmCompactedToCold} persistent_files_removed=${removedPersistentMirrorFiles} purged=${purged} memory_db_before=${beforeSnapshot.memoryDbBytes} memory_db_after=${afterSnapshot.memoryDbBytes} qmd_db_before=${beforeSnapshot.qmdDbBytes} qmd_db_after=${afterSnapshot.qmdDbBytes}`
      )
    } catch (error) {
      LogHelper.title('Memory Manager')
      LogHelper.warning(`Storage maintenance skipped: ${error}`)
    }
  }

  private async rotateDiscussionMarkdownFiles(
    activeRetentionCutoffTs: number,
    coldArchiveCutoffTs: number
  ): Promise<{
      warmArchived: number
      coldArchived: number
      warmCompactedToCold: number
    }> {
    await Promise.all([
      fs.promises.mkdir(this.discussionWarmArchivePath, { recursive: true }),
      fs.promises.mkdir(this.discussionColdArchivePath, { recursive: true })
    ])

    let warmArchived = 0
    let coldArchived = 0
    let warmCompactedToCold = 0

    const moveFile = async (sourcePath: string, destinationPath: string): Promise<void> => {
      await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true })

      try {
        await fs.promises.rename(sourcePath, destinationPath)
      } catch (error) {
        const message = String(error)
        if (!message.includes('EXDEV')) {
          throw error
        }
        await fs.promises.copyFile(sourcePath, destinationPath)
        await fs.promises.unlink(sourcePath)
      }
    }

    const archiveAsGzip = async (
      sourcePath: string,
      destinationPath: string
    ): Promise<void> => {
      await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true })

      if (fs.existsSync(destinationPath)) {
        await fs.promises.unlink(sourcePath)
        return
      }

      const sourceBuffer = await fs.promises.readFile(sourcePath)
      const compressed = gzipSync(sourceBuffer)
      await fs.promises.writeFile(destinationPath, compressed)
      await fs.promises.unlink(sourcePath)
    }

    const discussionEntries = await fs.promises.readdir(this.discussionPath, {
      withFileTypes: true
    })

    for (const entry of discussionEntries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) {
        continue
      }

      const dayKey = parseDayKeyFromFilename(entry.name)
      if (!dayKey) {
        continue
      }

      const dayTs = dayKeyToTs(dayKey)
      if (dayTs === null || dayTs > activeRetentionCutoffTs) {
        continue
      }

      const sourcePath = path.join(this.discussionPath, entry.name)
      const year = dayKey.slice(0, 4)
      const month = dayKey.slice(5, 7)

      if (dayTs > coldArchiveCutoffTs) {
        const warmDestinationPath = path.join(
          this.discussionWarmArchivePath,
          year,
          month,
          `${dayKey}.md`
        )
        if (fs.existsSync(warmDestinationPath)) {
          await fs.promises.unlink(sourcePath)
        } else {
          await moveFile(sourcePath, warmDestinationPath)
        }
        warmArchived += 1
        continue
      }

      const coldDestinationPath = path.join(
        this.discussionColdArchivePath,
        year,
        month,
        `${dayKey}.md.gz`
      )
      await archiveAsGzip(sourcePath, coldDestinationPath)
      coldArchived += 1
    }

    const compactWarmArchiveDirectory = async (directoryPath: string): Promise<void> => {
      const entries = await fs.promises.readdir(directoryPath, { withFileTypes: true })
      for (const entry of entries) {
        const entryPath = path.join(directoryPath, entry.name)
        if (entry.isDirectory()) {
          await compactWarmArchiveDirectory(entryPath)
          const nested = await fs.promises.readdir(entryPath)
          if (nested.length === 0) {
            await fs.promises.rmdir(entryPath)
          }
          continue
        }

        if (!entry.isFile() || !entry.name.endsWith('.md')) {
          continue
        }

        const dayKey = parseDayKeyFromFilename(entry.name)
        if (!dayKey) {
          continue
        }

        const dayTs = dayKeyToTs(dayKey)
        if (dayTs === null || dayTs > coldArchiveCutoffTs) {
          continue
        }

        const year = dayKey.slice(0, 4)
        const month = dayKey.slice(5, 7)
        const coldDestinationPath = path.join(
          this.discussionColdArchivePath,
          year,
          month,
          `${dayKey}.md.gz`
        )
        await archiveAsGzip(entryPath, coldDestinationPath)
        warmCompactedToCold += 1
      }
    }

    await compactWarmArchiveDirectory(this.discussionWarmArchivePath)

    return {
      warmArchived,
      coldArchived,
      warmCompactedToCold
    }
  }

  private async removePersistentMirrorFiles(
    entries: Array<{ id: string, createdAt: number }>
  ): Promise<number> {
    let removed = 0

    for (const entry of entries) {
      const filePath = this.getPersistentEntryFilePath(entry.id, entry.createdAt)
      try {
        await fs.promises.unlink(filePath)
        removed += 1
      } catch (error) {
        const message = String(error)
        if (!message.includes('ENOENT')) {
          throw error
        }
      }
    }

    return removed
  }
}
