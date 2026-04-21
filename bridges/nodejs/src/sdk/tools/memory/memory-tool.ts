import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

import SQLite from 'better-sqlite3'
import type { Database as SQLiteDatabase } from 'better-sqlite3'
import {
  CODEBASE_PATH,
  PROFILE_CONTEXT_PATH,
  PROFILE_MEMORY_DB_PATH,
  PROFILE_MEMORY_PATH
} from '@bridge/constants'
import {
  type QMDCollectionDefinition,
  type QMDStoreRow,
  QMDWriteLockTimeoutError,
  runQMDStoreSearch,
  updateQMDStore,
  getQMDStore,
  closeQMDStore
} from '@@/server/src/core/memory-manager/qmd/qmd-store'
import {
  buildAdaptiveQueryTokenSet,
  buildHydratedBacktrackCandidates,
  buildDiscriminativeSecondPass,
  buildExpansionQuery,
  buildFinalSupportTokens,
  buildFocusedHitContent,
  buildHydratedRescueBridgeTokens,
  buildLexicalSearchQuery,
  buildQueryTokenSet,
  DEFAULT_QMD_NAMESPACE_WEIGHTS,
  extractContent,
  extractScore,
  normalizeContent,
  normalizeFilename,
  normalizePath,
  pickStringDeep,
  rankRetrievedHits,
  resolveRequestedCollectionName,
  shouldRunAdaptiveSecondPass
} from '@@/server/src/core/memory-manager/qmd/qmd-retrieval'

import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

const QMD_INDEX_NAME = 'leon-memory'
const DEFAULT_TOP_K = 12
const DEFAULT_TOKEN_BUDGET = 480
const CONTEXT_FULL_CONTENT_CAP = 8_000
const BRIDGE_SOURCE_CONTENT_CAP = 96_000
const MIN_HIT_TOKEN_BUDGET = 48
const INDEX_UPDATE_MIN_INTERVAL_MS = 10_000

type MemoryScope = 'persistent' | 'daily' | 'discussion'
type MemoryKind =
  | 'fact'
  | 'preference'
  | 'event'
  | 'note'
  | 'summary'
  | 'knowledge'
  | 'task'
type MemorySourceType =
  | 'explicit_user'
  | 'inferred'
  | 'tool_output'
  | 'conversation'
  | 'system'
type KnowledgeNamespace =
  | 'memory_persistent'
  | 'memory_daily'
  | 'memory_discussion'
  | 'conversation_daily'
  | 'context'

interface MemoryReadOptions {
  namespaces?: string[]
  topK?: number
  tokenBudget?: number
  includeFacts?: boolean
  includeContext?: boolean
  contextFilenames?: string[]
}

interface MemoryWriteOptions {
  scope?: string
  kind?: string
  title?: string
  sourceType?: string
  sourceRef?: string
  importance?: number
  confidence?: number
  tags?: string[]
  dayKey?: string
  expiresAt?: number
  isPinned?: boolean
  metadata?: Record<string, unknown>
}

interface QMDHit {
  id: string
  path: string
  title: string
  content: string
  score: number
  namespace: KnowledgeNamespace
}

const MEMORY_PERSISTENT_PATH = path.join(PROFILE_MEMORY_PATH, 'persistent')
const MEMORY_DAILY_PATH = path.join(PROFILE_MEMORY_PATH, 'daily')
const MEMORY_DISCUSSION_PATH = path.join(PROFILE_MEMORY_PATH, 'discussion')
const MEMORY_SCHEMA_PATH = path.join(
  CODEBASE_PATH,
  'server',
  'src',
  'core',
  'memory-manager',
  'sql',
  'schema.sql'
)

type QMDSearchMode = 'query' | 'search'

const COLLECTIONS: Record<KnowledgeNamespace, { name: string, dir: string }> = {
  context: {
    name: 'context',
    dir: PROFILE_CONTEXT_PATH
  },
  memory_persistent: {
    name: 'memory-persistent',
    dir: MEMORY_PERSISTENT_PATH
  },
  memory_daily: {
    name: 'memory-daily',
    dir: MEMORY_DAILY_PATH
  },
  memory_discussion: {
    name: 'memory-discussion',
    dir: MEMORY_DISCUSSION_PATH
  },
  conversation_daily: {
    name: 'memory-daily',
    dir: MEMORY_DAILY_PATH
  }
}

const SDK_COLLECTIONS: QMDCollectionDefinition[] = [
  COLLECTIONS.context,
  COLLECTIONS.memory_persistent,
  COLLECTIONS.memory_daily,
  COLLECTIONS.memory_discussion
]

function toFactKeySegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function toDayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

function clipWithTokenBudget(
  content: string,
  remainingTokens: number
): { content: string, tokens: number } | null {
  if (remainingTokens <= 0) {
    return null
  }

  const fullTokens = Math.max(1, Math.ceil(content.length / 4))
  if (fullTokens <= remainingTokens) {
    return { content, tokens: fullTokens }
  }

  const maxChars = Math.max(96, remainingTokens * 4)
  if (maxChars >= content.length) {
    return {
      content,
      tokens: Math.max(1, Math.ceil(content.length / 4))
    }
  }

  const clipped = `${content.slice(0, maxChars).trimEnd()}...`
  return {
    content: clipped,
    tokens: Math.max(1, Math.ceil(clipped.length / 4))
  }
}

export default class MemoryTool extends Tool {
  private static readonly TOOLKIT = 'structured_knowledge'
  private static db: SQLiteDatabase | null = null
  private static storageReady = false
  private static collectionsReady = false
  private static lastIndexUpdateAt = 0

  private readonly config: ReturnType<typeof ToolkitConfig.load>

  constructor() {
    super()
    this.config = ToolkitConfig.load(MemoryTool.TOOLKIT, this.toolName)
    this.settings = ToolkitConfig.loadToolSettings(
      MemoryTool.TOOLKIT,
      this.toolName,
      {}
    )
    this.requiredSettings = []
    this.checkRequiredSettings(this.toolName)
  }

  get toolName(): string {
    return 'memory'
  }

  get toolkit(): string {
    return MemoryTool.TOOLKIT
  }

  get description(): string {
    return this.config['description']
  }

  public async read(
    query: string,
    options: MemoryReadOptions = {}
  ): Promise<Record<string, unknown>> {
    const normalizedQuery = String(query || '').trim()
    if (!normalizedQuery) {
      return {
        success: false,
        error: 'Query is required.'
      }
    }
    await this.ensureStorage()
    await this.ensureCollections()
    await this.updateIndex()

    const includeContext = options.includeContext === true
    const namespaces = this.normalizeNamespaces(options.namespaces, includeContext)
    const topK = this.normalizePositiveInt(options.topK, DEFAULT_TOP_K)
    const tokenBudget = this.normalizePositiveInt(
      options.tokenBudget,
      DEFAULT_TOKEN_BUDGET
    )
    const includeFacts = options.includeFacts !== false

    const allowedContextFilenames = new Set(
      (options.contextFilenames || []).map((filename) =>
        normalizeFilename(filename)
      )
    )

    const rawHits: QMDHit[] = []
    const perNamespaceLimit = Math.max(topK * 3, topK)
    const queryTokens = buildQueryTokenSet(normalizedQuery)
    const collectionNames = [
      ...new Set(
        namespaces
          .map((namespace) => COLLECTIONS[namespace]?.name)
          .filter((name): name is string => Boolean(name))
      )
    ]
    const namespaceByCollection = new Map<string, KnowledgeNamespace[]>(
      collectionNames.map((collectionName) => {
        const mappedNamespaces = namespaces.filter(
          (namespace) => COLLECTIONS[namespace]?.name === collectionName
        )
        return [collectionName, mappedNamespaces]
      })
    )
    const collectionPathByName = new Map<string, string>(
      collectionNames.map((collectionName) => {
        const collection = Object.values(COLLECTIONS).find(
          (item) => item.name === collectionName
        )
        return [collectionName, collection?.dir || '']
      })
    )
    const globalLimit = Math.max(
      topK,
      perNamespaceLimit * Math.max(1, collectionNames.length)
    )
    const retrievalStages: string[] = []
    const rewrittenQueries: string[] = []

    const runPreferredSearchModes = async (
      bridgeTerms: string[],
      scopedCollectionNames: string[],
      limit: number
    ): Promise<{
      rows: QMDStoreRow[]
      modeUsed: QMDSearchMode
    }> => {
      const lexicalQuery = buildLexicalSearchQuery(normalizedQuery, bridgeTerms)
      let rows = await this.runSearchMode(
        'query',
        buildExpansionQuery(normalizedQuery, bridgeTerms),
        scopedCollectionNames,
        limit
      )
      if (rows.length > 0) {
        return {
          rows,
          modeUsed: 'query'
        }
      }

      rows = await this.runSearchMode(
        'search',
        lexicalQuery,
        scopedCollectionNames,
        limit
      )

      return {
        rows,
        modeUsed: 'search'
      }
    }

    const namespaceWeights: Partial<Record<KnowledgeNamespace, number>> =
      DEFAULT_QMD_NAMESPACE_WEIGHTS

    const rankHitsByQuery = (
      hitsInput: QMDHit[]
    ): Array<{ hit: QMDHit, rankingScore: number, overlapCount: number }> => {
      return rankRetrievedHits(
        hitsInput,
        queryTokens,
        COLLECTIONS,
        namespaceWeights,
        BRIDGE_SOURCE_CONTENT_CAP
      )
    }

    const appendRows = (
      rowsToAppend: Array<Record<string, unknown>>,
      usedMode: QMDSearchMode
    ): void => {
      for (const row of rowsToAppend) {
        const sourcePath = normalizePath(
          pickStringDeep(row, [
            'filepath',
            'path',
            'file',
            'source',
            'doc_path',
            'document_path',
            'docPath',
            'uri'
          ])
        )
        const title =
          pickStringDeep(row, ['title', 'name']) ||
          (sourcePath ? path.basename(sourcePath) : '')
        const content = extractContent(row)
        const id =
          pickStringDeep(row, ['docid', 'id']) ||
          sourcePath ||
          title

        if (!id || !content) {
          continue
        }

        const explicitCollection = pickStringDeep(row, [
          'collection',
          'collection_name',
          'collectionName'
        ])
        const resolvedExplicitCollection = resolveRequestedCollectionName(
          explicitCollection,
          collectionNames
        )
        const collectionFromQmdPathMatch = sourcePath.match(/^qmd:\/\/([^/]+)\//i)
        const collectionFromQmdPath = resolveRequestedCollectionName(
          collectionFromQmdPathMatch?.[1] || '',
          collectionNames
        )
        const collectionFromAbsolutePath = collectionNames.find((collectionName) => {
          const collectionPath = collectionPathByName.get(collectionName)
          if (!collectionPath || !sourcePath) {
            return false
          }

          return sourcePath.startsWith(collectionPath)
        })
        const resolvedCollectionName =
          resolvedExplicitCollection ||
          collectionFromQmdPath ||
          collectionFromAbsolutePath ||
          (collectionNames.length === 1 ? collectionNames[0] : '')
        if (!resolvedCollectionName) {
          continue
        }
        const mappedNamespaces = namespaceByCollection.get(resolvedCollectionName) || []
        const namespace =
          namespaces.find((candidate) => mappedNamespaces.includes(candidate)) ||
          (namespaces.length === 1 ? namespaces[0] : null)
        if (!namespace) {
          continue
        }

        if (namespace === 'context' && allowedContextFilenames.size > 0) {
          const allowed =
            allowedContextFilenames.has(normalizeFilename(sourcePath)) ||
            allowedContextFilenames.has(normalizeFilename(title))
          if (!allowed) {
            continue
          }
        }

        rawHits.push({
          id,
          path: sourcePath,
          title,
          content,
          score: extractScore(row) + (usedMode === 'query' ? 0.03 : 0.01),
          namespace
        })
      }
    }

    const { rows, modeUsed } = await runPreferredSearchModes(
      [],
      collectionNames,
      globalLimit
    )
    retrievalStages.push(`initial:${modeUsed}:${rows.length}`)

    appendRows(rows, modeUsed)

    let rankedHits = rankHitsByQuery(rawHits)
    const hasQmdPersistentHit = (): boolean =>
      rawHits.some(
        (hit) =>
          hit.namespace === 'memory_persistent' &&
          !hit.path.startsWith('memory-db://')
      )
    const shouldEnrichWithFullSearch =
      !hasQmdPersistentHit() || shouldRunAdaptiveSecondPass(rankedHits)

    if (shouldEnrichWithFullSearch) {
      const searchRows = await this.runSearchMode(
        'search',
        buildLexicalSearchQuery(normalizedQuery),
        collectionNames,
        globalLimit
      )
      appendRows(searchRows, 'search')
      retrievalStages.push(`enrich:search:${searchRows.length}`)
    }

    const missingNamespaces = namespaces.filter(
      (namespace) => !rawHits.some((hit) => hit.namespace === namespace)
    )
    for (const missingNamespace of missingNamespaces) {
      const collectionName = COLLECTIONS[missingNamespace]?.name
      if (!collectionName) {
        continue
      }

      const { rows: scopedRows, modeUsed: scopedMode } =
        await runPreferredSearchModes(
          [],
          [collectionName],
          perNamespaceLimit
        )

      appendRows(scopedRows, scopedMode)
    }

    rankedHits = rankHitsByQuery(rawHits)
    let secondPassSupportTokens: string[] = []
    if (!hasQmdPersistentHit() || shouldRunAdaptiveSecondPass(rankedHits)) {
      const secondPass = buildDiscriminativeSecondPass(
        normalizedQuery,
        queryTokens,
        rankedHits.map((rankedHit) => rankedHit.hit),
        COLLECTIONS,
        BRIDGE_SOURCE_CONTENT_CAP
      )

      if (secondPass) {
        secondPassSupportTokens = secondPass.bridgeTokens
        rewrittenQueries.push(`second_pass=${JSON.stringify(secondPass.lexicalQuery)}`)
        const {
          rows: secondPassRows,
          modeUsed: secondPassMode
        } = await runPreferredSearchModes(
          secondPass.bridgeTokens,
          collectionNames,
          globalLimit
        )

        appendRows(secondPassRows, secondPassMode)
        retrievalStages.push(`second_pass:${secondPassMode}:${secondPassRows.length}`)

        const stillMissingNamespaces = namespaces.filter(
          (namespace) => !rawHits.some((hit) => hit.namespace === namespace)
        )
        for (const missingNamespace of stillMissingNamespaces) {
          const collectionName = COLLECTIONS[missingNamespace]?.name
          if (!collectionName) {
            continue
          }

          const { rows: scopedRows, modeUsed: scopedMode } =
            await runPreferredSearchModes(
              secondPass.bridgeTokens,
              [collectionName],
              perNamespaceLimit
            )

          appendRows(scopedRows, scopedMode)
        }

        rankedHits = rankHitsByQuery(rawHits)
      }
    }

    rankedHits = rankHitsByQuery(rawHits)
    let rescueSupportTokens: string[] = []
    const rescueBridgeTokens = buildHydratedRescueBridgeTokens(
      queryTokens,
      rankedHits,
      COLLECTIONS,
      BRIDGE_SOURCE_CONTENT_CAP
    ).filter((token) => !secondPassSupportTokens.includes(token))

    if (rescueBridgeTokens.length > 0) {
      rescueSupportTokens = rescueBridgeTokens
      rewrittenQueries.push(
        `rescue=${JSON.stringify(buildLexicalSearchQuery(normalizedQuery, rescueBridgeTokens))}`
      )
      const {
        rows: rescueRows,
        modeUsed: rescueMode
      } = await runPreferredSearchModes(
        rescueBridgeTokens,
        collectionNames,
        globalLimit
      )

      appendRows(rescueRows, rescueMode)
      retrievalStages.push(`rescue:${rescueMode}:${rescueRows.length}`)

      const stillMissingNamespaces = namespaces.filter(
        (namespace) => !rawHits.some((hit) => hit.namespace === namespace)
      )
      for (const missingNamespace of stillMissingNamespaces) {
        const collectionName = COLLECTIONS[missingNamespace]?.name
        if (!collectionName) {
          continue
        }

        const { rows: scopedRows, modeUsed: scopedMode } =
          await runPreferredSearchModes(
            rescueBridgeTokens,
            [collectionName],
            perNamespaceLimit
          )

        appendRows(scopedRows, scopedMode)
      }

      rankedHits = rankHitsByQuery(rawHits)
    }

    const backtrackCandidates = buildHydratedBacktrackCandidates(
      queryTokens,
      rankedHits,
      COLLECTIONS,
      namespaceWeights,
      BRIDGE_SOURCE_CONTENT_CAP
    )
    const existingHitPaths = new Set(
      rawHits.map((hit) => `${hit.namespace}|${hit.path}`)
    )
    const appendedBacktrackHits = backtrackCandidates
      .filter((candidate) => !existingHitPaths.has(
        `${candidate.hit.namespace}|${candidate.hit.path}`
      ))
      .slice(0, 4)

    if (appendedBacktrackHits.length > 0) {
      for (const candidate of appendedBacktrackHits) {
        rawHits.push({
          ...candidate.hit,
          score: Math.max(candidate.hit.score, candidate.rankingScore)
        })
      }
      retrievalStages.push(`backtrack:local:${appendedBacktrackHits.length}`)
      rankedHits = rankHitsByQuery(rawHits)
    }

    const excerptQueryTokens = buildAdaptiveQueryTokenSet(
      queryTokens,
      rankedHits.map((rankedHit) => rankedHit.hit),
      COLLECTIONS,
      BRIDGE_SOURCE_CONTENT_CAP
    )

    const supportTokens = buildFinalSupportTokens(
      excerptQueryTokens,
      rankedHits,
      COLLECTIONS,
      BRIDGE_SOURCE_CONTENT_CAP,
      [...secondPassSupportTokens, ...rescueSupportTokens]
    )

    const focusedContentCache = new Map<string, string>()
    const getFocusedHitContent = (hit: QMDHit): string => {
      const cacheKey = `${hit.namespace}|${hit.path}|${hit.title}|${hit.id}`
      const cachedContent = focusedContentCache.get(cacheKey)
      if (cachedContent) {
        return cachedContent
      }

      const focusedContent = buildFocusedHitContent(
        hit,
        excerptQueryTokens,
        supportTokens,
        COLLECTIONS,
        BRIDGE_SOURCE_CONTENT_CAP
      )
      focusedContentCache.set(cacheKey, focusedContent)
      return focusedContent
    }

    const selected: Array<{
      namespace: KnowledgeNamespace
      title: string | null
      content: string
      score: number
      sourcePath: string | null
    }> = []
    const selectedKeys = new Set<string>()
    let usedTokenEstimate = 0

    const addHit = (
      hit: QMDHit,
      rankingScore: number,
      budgetHint?: number
    ): boolean => {
      if (selected.length >= topK || usedTokenEstimate >= tokenBudget) {
        return false
      }

      const hitKey = `${hit.namespace}|${hit.path}|${hit.content}`
      if (selectedKeys.has(hitKey)) {
        return false
      }

      const remainingBudget = tokenBudget - usedTokenEstimate
      const perHitBudget =
        budgetHint && budgetHint > 0
          ? Math.min(remainingBudget, budgetHint)
          : selected.length === 0
            ? Math.max(96, Math.floor(tokenBudget * 0.6))
            : remainingBudget

      const clipped = clipWithTokenBudget(
        getFocusedHitContent(hit),
        Math.min(remainingBudget, perHitBudget)
      )
      if (!clipped) {
        return false
      }

      selected.push({
        namespace: hit.namespace,
        title: hit.title || null,
        content:
          hit.namespace === 'context'
            ? clipped.content.slice(0, CONTEXT_FULL_CONTENT_CAP)
            : clipped.content,
        score: rankingScore,
        sourcePath: hit.path || null
      })
      selectedKeys.add(hitKey)
      usedTokenEstimate += clipped.tokens
      return true
    }

    const namespaceCoverageQueue: KnowledgeNamespace[] = [...new Set(namespaces)]
      .filter(
        (namespace) =>
          namespace !== 'context' &&
          !(namespace === 'conversation_daily' && namespaces.includes('memory_daily'))
      )
    for (const [index, namespace] of namespaceCoverageQueue.entries()) {
      const firstByNamespace = rankedHits.find(
        (rankedHit) => rankedHit.hit.namespace === namespace
      )
      if (!firstByNamespace) {
        continue
      }

      const remainingCoverageNamespaces = Math.max(
        1,
        namespaceCoverageQueue.length - index
      )
      const namespaceBudget = Math.max(
        MIN_HIT_TOKEN_BUDGET,
        Math.floor((tokenBudget - usedTokenEstimate) / remainingCoverageNamespaces)
      )
      const cappedNamespaceBudget = Math.min(
        namespaceBudget,
        Math.max(192, Math.floor(tokenBudget * 0.28))
      )

      addHit(
        firstByNamespace.hit,
        firstByNamespace.rankingScore,
        cappedNamespaceBudget
      )
    }

    for (const rankedHit of rankedHits) {
      if (selected.length >= topK || usedTokenEstimate >= tokenBudget) {
        break
      }

      const remainingResultSlots = Math.max(1, topK - selected.length)
      const rollingBudget = Math.max(
        MIN_HIT_TOKEN_BUDGET,
        Math.floor((tokenBudget - usedTokenEstimate) / remainingResultSlots)
      )

      addHit(rankedHit.hit, rankedHit.rankingScore, rollingBudget)
    }

    const facts = includeFacts ? this.readFacts(8) : []
    this.log(
      `memory.read retrieval stages=${retrievalStages.join(' -> ')} final_hits=${selected.length} used_tokens=${usedTokenEstimate}`
    )
    if (rewrittenQueries.length > 0) {
      this.log(`memory.read rewritten ${rewrittenQueries.join(' | ')}`)
    }

    return {
      success: true,
      data: {
        query: normalizedQuery,
        namespaces,
        topK,
        tokenBudget,
        usedTokenEstimate,
        hits: selected,
        facts
      }
    }
  }

  public async write(
    content: string,
    options: MemoryWriteOptions = {}
  ): Promise<Record<string, unknown>> {
    const normalizedContent = normalizeContent(String(content || ''))
    if (!normalizedContent) {
      return {
        success: false,
        error: 'Content is required.'
      }
    }

    await this.ensureStorage()

    const db = this.getDb()
    const now = Date.now()
    const scope = this.normalizeScope(options.scope)
    const kind = this.normalizeKind(options.kind)
    const sourceType = this.normalizeSourceType(options.sourceType)
    const dayKey = options.dayKey || toDayKey(now)
    const dedupeHash = createHash('sha256')
      .update(`${scope}|${kind}|${normalizedContent.toLowerCase()}`)
      .digest('hex')

    const existing = db
      .prepare(
        `SELECT * FROM memory_items
         WHERE scope = ? AND dedupe_hash = ? AND is_deleted = 0
         LIMIT 1`
      )
      .get(scope, dedupeHash) as Record<string, unknown> | undefined

    const itemId = existing && typeof existing['id'] === 'string'
      ? String(existing['id'])
      : randomUUID()

    if (existing) {
      db.prepare(
        `UPDATE memory_items
         SET title = ?,
             content_md = ?,
             content_text = ?,
             source_type = ?,
             source_ref = ?,
             importance = ?,
             confidence = ?,
             day_key = ?,
             updated_at = ?,
             expires_at = ?,
             is_pinned = ?,
             metadata_json = ?
         WHERE id = ?`
      ).run(
        options.title || null,
        normalizedContent,
        normalizedContent,
        sourceType,
        options.sourceRef || null,
        this.normalizeScore(options.importance, 0.5),
        this.normalizeScore(options.confidence, 0.7),
        dayKey,
        now,
        typeof options.expiresAt === 'number' ? options.expiresAt : null,
        options.isPinned ? 1 : 0,
        JSON.stringify(options.metadata || {}),
        itemId
      )
    } else {
      db.prepare(
        `INSERT INTO memory_items (
          id, scope, kind, title, content_md, content_text,
          source_type, source_ref, importance, confidence, day_key,
          created_at, updated_at, expires_at, is_pinned,
          supersedes_item_id, dedupe_hash, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        itemId,
        scope,
        kind,
        options.title || null,
        normalizedContent,
        normalizedContent,
        sourceType,
        options.sourceRef || null,
        this.normalizeScore(options.importance, 0.5),
        this.normalizeScore(options.confidence, 0.7),
        dayKey,
        now,
        now,
        typeof options.expiresAt === 'number' ? options.expiresAt : null,
        options.isPinned ? 1 : 0,
        null,
        dedupeHash,
        JSON.stringify(options.metadata || {})
      )
    }

    if (scope === 'persistent' && (kind === 'fact' || kind === 'preference')) {
      const factRecord = this.buildStructuredFactRecord({
        kind,
        title: options.title || null,
        content: normalizedContent,
        metadata: options.metadata || {},
        sourceItemId: itemId
      })
      this.upsertFact(factRecord)
    }

    await this.writeMarkdownMirror({
      id: itemId,
      scope,
      kind,
      title: options.title || null,
      content: normalizedContent,
      dayKey,
      createdAt: existing && typeof existing['created_at'] === 'number'
        ? Number(existing['created_at'])
        : now
    })

    await this.ensureCollections()
    await this.updateIndex()

    return {
      success: true,
      data: {
        id: itemId,
        scope,
        kind,
        title: options.title || null,
        content: normalizedContent,
        createdAt: existing && typeof existing['created_at'] === 'number'
          ? Number(existing['created_at'])
          : now,
        updatedAt: now
      }
    }
  }

  private normalizePositiveInt(value: unknown, fallback: number): number {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback
    }
    return Math.floor(parsed)
  }

  private normalizeScope(value: unknown): MemoryScope {
    if (value === 'daily' || value === 'discussion' || value === 'persistent') {
      return value
    }
    return 'persistent'
  }

  private normalizeKind(value: unknown): MemoryKind {
    const allowed = new Set<MemoryKind>([
      'fact',
      'preference',
      'event',
      'note',
      'summary',
      'knowledge',
      'task'
    ])
    return allowed.has(value as MemoryKind) ? (value as MemoryKind) : 'note'
  }

  private normalizeSourceType(value: unknown): MemorySourceType {
    const allowed = new Set<MemorySourceType>([
      'explicit_user',
      'inferred',
      'tool_output',
      'conversation',
      'system'
    ])
    return allowed.has(value as MemorySourceType)
      ? (value as MemorySourceType)
      : 'explicit_user'
  }

  private buildStructuredFactRecord(input: {
    kind: MemoryKind
    title: string | null
    content: string
    metadata: Record<string, unknown>
    sourceItemId: string
  }): {
    key: string
    value: unknown
    text: string
    priority: number
    sourceItemId: string
  } {
    const metadataFactKey = input.metadata['factKey']
    const explicitFactKey =
      typeof metadataFactKey === 'string' ? toFactKeySegment(metadataFactKey) : ''
    const titleKey = input.title ? toFactKeySegment(input.title) : ''
    const fallbackKey = createHash('sha256')
      .update(`${input.kind}|${input.content.toLowerCase()}`)
      .digest('hex')
      .slice(0, 24)
    const key = explicitFactKey || `owner.${input.kind}.${titleKey || fallbackKey}`
    const text = input.title
      ? `${input.title}: ${input.content}`
      : input.content

    return {
      key,
      value: {
        kind: input.kind,
        title: input.title,
        content: input.content
      },
      text,
      priority: input.kind === 'fact' ? 90 : 80,
      sourceItemId: input.sourceItemId
    }
  }

  private normalizeScore(value: unknown, fallback: number): number {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) {
      return fallback
    }

    return Math.max(0, Math.min(1, parsed))
  }

  private normalizeNamespaces(
    value: unknown,
    includeContext: boolean
  ): KnowledgeNamespace[] {
    const allowed = new Set<KnowledgeNamespace>([
      'memory_persistent',
      'memory_daily',
      'memory_discussion',
      'conversation_daily',
      'context'
    ])
    const input = Array.isArray(value)
      ? value.filter((item): item is KnowledgeNamespace =>
          typeof item === 'string' && allowed.has(item as KnowledgeNamespace)
        )
      : []
    const namespaces: KnowledgeNamespace[] =
      input.length > 0
        ? input
        : ['memory_persistent', 'memory_daily', 'memory_discussion']

    if (includeContext) {
      return Array.from(new Set<KnowledgeNamespace>([...namespaces, 'context']))
    }

    return namespaces.filter((namespace) => namespace !== 'context')
  }

  private getDb(): SQLiteDatabase {
    if (!MemoryTool.db) {
      throw new Error('Memory database is not initialized.')
    }

    return MemoryTool.db
  }

  private async ensureStorage(): Promise<void> {
    if (MemoryTool.storageReady) {
      return
    }

    await Promise.all([
      fs.promises.mkdir(PROFILE_MEMORY_PATH, { recursive: true }),
      fs.promises.mkdir(MEMORY_PERSISTENT_PATH, { recursive: true }),
      fs.promises.mkdir(MEMORY_DAILY_PATH, { recursive: true }),
      fs.promises.mkdir(MEMORY_DISCUSSION_PATH, { recursive: true }),
      fs.promises.mkdir(PROFILE_CONTEXT_PATH, { recursive: true })
    ])

    if (!MemoryTool.db) {
      MemoryTool.db = new SQLite(PROFILE_MEMORY_DB_PATH)
      const schemaSQL = await fs.promises.readFile(MEMORY_SCHEMA_PATH, 'utf8')
      MemoryTool.db.exec(schemaSQL)
    }

    MemoryTool.storageReady = true
  }

  private async ensureCollections(): Promise<void> {
    if (MemoryTool.collectionsReady) {
      return
    }

    await Promise.all(
      SDK_COLLECTIONS.map((collection) =>
        fs.promises.mkdir(collection.dir, { recursive: true })
      )
    )
    await getQMDStore(QMD_INDEX_NAME, SDK_COLLECTIONS)

    MemoryTool.collectionsReady = true
  }

  private async updateIndex(): Promise<void> {
    const now = Date.now()
    if (
      MemoryTool.lastIndexUpdateAt > 0 &&
      now - MemoryTool.lastIndexUpdateAt < INDEX_UPDATE_MIN_INTERVAL_MS
    ) {
      return
    }

    try {
      await updateQMDStore({
        indexName: QMD_INDEX_NAME,
        collections: SDK_COLLECTIONS
      })
      MemoryTool.lastIndexUpdateAt = now
    } catch (error) {
      if (error instanceof QMDWriteLockTimeoutError) {
        this.log(
          `memory.read skipped index refresh because another process is updating QMD; continuing with the current index snapshot. ${error.message}`
        )
        return
      }

      throw error
    }
  }

  private async runSearchMode(
    mode: QMDSearchMode,
    query: string,
    collectionNames: string[],
    limit: number
  ): Promise<QMDStoreRow[]> {
    if (!query.trim()) {
      return []
    }

    try {
      return await runQMDStoreSearch({
        indexName: QMD_INDEX_NAME,
        collections: SDK_COLLECTIONS,
        mode,
        query,
        collectionNames,
        limit
      })
    } catch (error) {
      const message = String(error).toLowerCase()
      if (mode === 'query' && message.includes('not found')) {
        return this.runSearchMode('search', query, collectionNames, limit)
      }

      return []
    }
  }

  private readFacts(limit: number): Array<{ key: string, text: string }> {
    const db = this.getDb()
    const rows = db
      .prepare(
        `SELECT fact_key, canonical_text
         FROM memory_facts
         WHERE is_deleted = 0
         ORDER BY priority DESC, updated_at DESC
         LIMIT ?`
      )
      .all(limit) as Array<Record<string, unknown>>

    return rows.map((row) => ({
      key: String(row['fact_key'] || ''),
      text: String(row['canonical_text'] || '')
    }))
  }

  private upsertFact(input: {
    key: string
    value: unknown
    text: string
    priority: number
    sourceItemId: string
  }): void {
    const db = this.getDb()
    const now = Date.now()
    const existing = db
      .prepare(
        `SELECT id
         FROM memory_facts
         WHERE fact_key = ? AND is_deleted = 0
         LIMIT 1`
      )
      .get(input.key) as Record<string, unknown> | undefined

    if (existing?.['id']) {
      db.prepare(
        `UPDATE memory_facts
         SET fact_value_json = ?,
             canonical_text = ?,
             source_item_id = ?,
             priority = ?,
             updated_at = ?,
             last_seen_at = ?
         WHERE id = ?`
      ).run(
        JSON.stringify(input.value),
        input.text,
        input.sourceItemId,
        input.priority,
        now,
        now,
        String(existing['id'])
      )
      return
    }

    db.prepare(
      `INSERT INTO memory_facts (
         id, fact_key, fact_value_json, canonical_text, priority,
         source_item_id, created_at, updated_at, last_seen_at, is_pinned, is_deleted
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`
    ).run(
      randomUUID(),
      input.key,
      JSON.stringify(input.value),
      input.text,
      input.priority,
      input.sourceItemId,
      now,
      now,
      now
    )
  }

  private async writeMarkdownMirror(input: {
    id: string
    scope: MemoryScope
    kind: MemoryKind
    title: string | null
    content: string
    dayKey: string
    createdAt: number
  }): Promise<void> {
    if (input.scope === 'persistent') {
      const date = new Date(input.createdAt)
      const year = String(date.getUTCFullYear())
      const month = String(date.getUTCMonth() + 1).padStart(2, '0')
      const day = String(date.getUTCDate()).padStart(2, '0')
      const filePath = path.join(
        MEMORY_PERSISTENT_PATH,
        year,
        month,
        day,
        `${input.id}.md`
      )
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
      const markdown = `> Persistent memory entry (${input.kind})\n\n# ${
        input.title || input.kind
      }\n\nID: ${input.id}\nCreated At: ${new Date(
        input.createdAt
      ).toISOString()}\n\n${input.content}\n`
      await fs.promises.writeFile(filePath, markdown, 'utf8')
      return
    }

    if (input.scope === 'daily' && input.kind === 'summary') {
      const filePath = path.join(MEMORY_DAILY_PATH, `${input.dayKey}.md`)
      await fs.promises.writeFile(filePath, input.content, 'utf8')
      return
    }

    if (input.scope === 'discussion') {
      const filePath = path.join(MEMORY_DISCUSSION_PATH, `${input.dayKey}.md`)
      const line = `- ${new Date(input.createdAt).toISOString()} | ${input.content.replace(/\n/g, ' | ')}\n`
      if (!fs.existsSync(filePath)) {
        const header = `> Discussion memory for ${input.dayKey}. Short-term rolling conversation context.\n# ${input.dayKey}\n\n`
        await fs.promises.writeFile(filePath, `${header}${line}`, 'utf8')
      } else {
        await fs.promises.appendFile(filePath, line, 'utf8')
      }
    }
  }

  public static dispose(): void {
    try {
      MemoryTool.db?.close()
    } catch {
      // Ignore close errors.
    }
    MemoryTool.db = null
    MemoryTool.storageReady = false
    MemoryTool.collectionsReady = false
    void closeQMDStore(QMD_INDEX_NAME)
  }
}
