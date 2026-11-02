import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

import SQLite from 'better-sqlite3'
import type { Database as SQLiteDatabase } from 'better-sqlite3'
import {
  CODEBASE_PATH,
  PROFILE_CONTEXT_PATH,
  PROFILE_MEMORY_DB_PATH,
  PROFILE_MEMORY_PATH,
  PROFILE_SESSIONS_PATH
} from '@bridge/constants'
import { upgradeMemoryScope } from '@@/scripts/setup/migrations/2026102907370753-add-temporary-memory-scope.js'
import { getTemporaryContextSize, resolveTemporaryExpiration, resolveTemporaryMemoryPolicy } from '@@/bridges/runtime/nodejs/temporary-memory'
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
  extractOverlapCount,
  extractScore,
  normalizeContent,
  normalizeFilename,
  normalizePath,
  pickStringDeep,
  rankRetrievedHits,
  resolveRequestedCollectionName,
  shouldRunAdaptiveSecondPass
} from '@@/server/src/core/memory-manager/qmd/qmd-retrieval'

import { LEON_PROFILE_NAME } from '@@/server/src/leon-roots'
import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

// Reuse Core's profile index instead of reconfiguring a shared search collection.
const QMD_INDEX_NAME = `leon-memory-${LEON_PROFILE_NAME}`
const CONVERSATION_DATABASE_FILENAME = 'conversations.sqlite'
const DEFAULT_TOP_K = 12
const DEFAULT_TOKEN_BUDGET = 480
const CONTEXT_FULL_CONTENT_CAP = 8_000
const BRIDGE_SOURCE_CONTENT_CAP = 96_000
const MIN_HIT_TOKEN_BUDGET = 48
const MAX_READ_ITEMS = 48
const MAX_DATABASE_RESCUE_ITEMS = 500
const MAX_READ_TOKEN_BUDGET = 4_000
const INDEX_UPDATE_MIN_INTERVAL_MS = 10_000

type MemoryScope = 'persistent' | 'daily' | 'discussion' | 'temporary'
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
  scope?: 'temporary'
  namespaces?: string[]
  topK?: number
  tokenBudget?: number
  includeFacts?: boolean
  includeContext?: boolean
  contextFilenames?: string[]
  itemIds?: string[]
  offset?: number
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
  supersedesItemId?: string
  evidence?: string
}

interface QMDHit {
  id: string
  path: string
  title: string
  content: string
  score: number
  namespace: KnowledgeNamespace
  authoritative?: boolean
  sourceType?: string
  sourceRef?: string | null
  scope?: MemoryScope
  kind?: MemoryKind
  createdAt?: number
  updatedAt?: number
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

  const maxChars = remainingTokens * 4
  const clipped = content.slice(0, maxChars)
  return { content: clipped, tokens: Math.ceil(clipped.length / 4) }
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
    if (options.itemIds?.length) {
      return this.readItems(normalizedQuery, options)
    }
    const includeContext = options.includeContext === true
    const namespaces = this.normalizeNamespaces(options.namespaces, includeContext)
    const topK = Math.min(MAX_READ_ITEMS, this.normalizePositiveInt(options.topK, DEFAULT_TOP_K))
    const tokenBudget = Math.min(MAX_READ_TOKEN_BUDGET, this.normalizePositiveInt(
      options.tokenBudget,
      DEFAULT_TOKEN_BUDGET
    ))
    const includeFacts = options.includeFacts !== false
    if (options.scope === 'temporary') {
      return this.readTemporary(normalizedQuery, topK, tokenBudget)
    }

    // SQLite is authoritative: an empty store cannot produce valid indexed hits.
    // Avoid loading hybrid search models just to rediscover that there is no evidence.
    const hasMemory = this.getDb().prepare(
      'SELECT 1 FROM active_memory_items WHERE scope != \'temporary\' LIMIT 1'
    ).get()
    if (!namespaces.includes('context') && !hasMemory &&
      (!includeFacts || this.readFacts(1).length === 0)) {
      return {
        success: true,
        data: {
          query: normalizedQuery, namespaces, topK, tokenBudget,
          usedTokenEstimate: 0, hits: [], facts: [],
          candidateCount: 0, omittedCandidateCount: 0
        }
      }
    }

    await this.ensureCollections()
    await this.updateIndex()

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
        hitsInput.flatMap((hit) => this.resolveMemoryHit(hit)),
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

    // Long lexical queries can miss every indexed document. Reuse the same ranker
    // over a bounded set of current rows before declaring the owner's memory empty.
    if (rankedHits.length === 0 && queryTokens.size > 0) {
      const records = this.getDb().prepare(
        'SELECT * FROM active_memory_items WHERE scope != \'temporary\' ORDER BY updated_at DESC LIMIT ?'
      ).all(MAX_DATABASE_RESCUE_ITEMS)
      for (const record of records) {
        const namespace = `memory_${record['scope']}` as KnowledgeNamespace
        const requestedNamespace = namespaces.includes(namespace) ? namespace
          : namespace === 'memory_daily' && namespaces.includes('conversation_daily') ? 'conversation_daily' : null
        if (!requestedNamespace) {
          continue
        }
        const hit: QMDHit = {
          id: String(record['id']), path: `memory-db://${record['id']}`,
          title: String(record['title'] || record['kind']),
          content: String(record['content_md']), score: 0,
          namespace: requestedNamespace, authoritative: true
        }
        if (extractOverlapCount(queryTokens, hit, COLLECTIONS, BRIDGE_SOURCE_CONTENT_CAP) > 0) {
          rawHits.push(hit)
        }
      }
      rankedHits = rankHitsByQuery(rawHits)
      retrievalStages.push(`rescue:database:${rankedHits.length}`)
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

    // Reserve space for complementary records instead of seeding each storage namespace.
    const seenIds = new Set<string>()
    const seenContents = new Set<string>()
    const candidates = rankedHits.filter(({ hit }) => {
      const contentKey = normalizeContent(hit.content).toLowerCase()
      if (seenIds.has(hit.id) || seenContents.has(contentKey)) {
        return false
      }
      seenIds.add(hit.id)
      seenContents.add(contentKey)
      return true
    })
    const selected: Array<{
      id: string
      content: string
      scope?: MemoryScope
      kind?: MemoryKind
      sourceType?: string
      sourceRef: string | null
      createdAt: number | null
      updatedAt: number | null
      namespace: KnowledgeNamespace
      title: string | null
      score: number
      sourcePath: string | null
      excerpted: boolean
      truncated: boolean
    }> = []
    let usedTokenEstimate = 0

    for (const { hit, rankingScore } of candidates) {
      if (selected.length >= topK || usedTokenEstimate >= tokenBudget) {
        break
      }

      const remainingSlots = Math.min(topK, candidates.length) - selected.length
      const budget = Math.min(tokenBudget - usedTokenEstimate, Math.max(
        MIN_HIT_TOKEN_BUDGET,
        Math.floor((tokenBudget - usedTokenEstimate) / remainingSlots)
      ))
      const focused = getFocusedHitContent(hit)
      const clipped = clipWithTokenBudget(focused, budget)
      if (!clipped) {
        continue
      }
      const content = hit.namespace === 'context'
        ? clipped.content.slice(0, CONTEXT_FULL_CONTENT_CAP)
        : clipped.content
      selected.push({
        id: hit.id,
        ...(hit.scope ? { scope: hit.scope } : {}),
        ...(hit.kind ? { kind: hit.kind } : {}),
        ...(hit.sourceType ? { sourceType: hit.sourceType } : {}),
        sourceRef: hit.sourceRef ?? null,
        createdAt: hit.createdAt ?? null, updatedAt: hit.updatedAt ?? null,
        namespace: hit.namespace, title: hit.title || null,
        content, score: rankingScore, sourcePath: hit.path || null,
        excerpted: normalizeContent(focused) !== normalizeContent(hit.content),
        truncated: content.length < focused.length
      })
      usedTokenEstimate += Math.ceil(content.length / 4)
    }

    // Optional facts share the same budget and must not repeat selected records.
    const facts = includeFacts ? this.readFacts(8).filter((fact) => {
      const cost = Math.ceil(fact.text.length / 4)
      if (selected.some((hit) => hit.id === fact.id) ||
        ![...buildQueryTokenSet(fact.text)].some((token) => queryTokens.has(token)) ||
        cost > tokenBudget - usedTokenEstimate) {
        return false
      }
      usedTokenEstimate += cost
      return true
    }) : []
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
        candidateCount: candidates.length,
        omittedCandidateCount: candidates.length - selected.length,
        facts
      }
    }
  }

  /**
   * Recover current circumstances omitted from injection without initializing search.
   */
  private readTemporary(query: string, topK: number, tokenBudget: number): Record<string, unknown> {
    const records = this.getDb().prepare(`SELECT * FROM active_memory_items
      WHERE scope = 'temporary' AND expires_at > ?
      ORDER BY (source_type = 'explicit_user') DESC, importance DESC, updated_at DESC, id
      LIMIT ?`).all(Date.now(), MAX_DATABASE_RESCUE_ITEMS + 1)
    const queryTokens = buildQueryTokenSet(query)
    const collections = { temporary: { name: 'temporary', dir: '' } }
    const ranked = rankRetrievedHits(records.slice(0, MAX_DATABASE_RESCUE_ITEMS).map((record) => ({
      id: String(record['id']), title: String(record['title'] || ''),
      content: String(record['content_md']), namespace: 'temporary' as const,
      path: '', score: 0, authoritative: true
    })), queryTokens, collections)
    // Original query terms establish relevance even when reranking suppresses common terms.
    const matching = ranked.filter(({ hit }) =>
      extractOverlapCount(queryTokens, hit, collections, BRIDGE_SOURCE_CONTENT_CAP) > 0)
    const candidates = matching.length > 0 ? matching : ranked
    const hits = []
    let usedTokenEstimate = 0

    for (const { hit } of candidates) {
      if (hits.length >= topK) {
        break
      }
      const record = records.find((entry) => entry['id'] === hit.id)!
      const selected = {
        id: hit.id, scope: 'temporary', content: hit.content,
        sourceType: record['source_type'], sourceRef: record['source_ref'],
        createdAt: record['created_at'], updatedAt: record['updated_at'],
        expiresAt: record['expires_at'], truncated: false, excerpted: false
      }
      const tokens = Math.ceil(Buffer.byteLength(JSON.stringify(selected), 'utf8') / 4)
      // A shortened circumstance could lose its exception or time qualification.
      if (usedTokenEstimate + tokens > tokenBudget) {
        continue
      }
      hits.push(selected)
      usedTokenEstimate += tokens
    }

    return { success: true, data: {
      query, scope: 'temporary', topK, tokenBudget, usedTokenEstimate, hits, facts: [],
      candidateCount: candidates.length,
      omittedCandidateCount: candidates.length - hits.length,
      candidateLimitReached: records.length > MAX_DATABASE_RESCUE_ITEMS,
      matchedQuery: matching.length > 0
    } }
  }

  /**
   * Expand selected active records without repeating search or rehydrating retired files.
   */
  private readItems(query: string, options: MemoryReadOptions): Record<string, unknown> {
    const itemIds = [...new Set(options.itemIds)].slice(0, MAX_READ_ITEMS)
    const tokenBudget = Math.min(MAX_READ_TOKEN_BUDGET,
      this.normalizePositiveInt(options.tokenBudget, DEFAULT_TOKEN_BUDGET))
    const offset = Number.isFinite(options.offset) ? Math.max(0, Math.floor(options.offset ?? 0)) : 0
    const hits = []
    const unavailableItemIds = []
    let usedTokenEstimate = 0

    for (const id of itemIds) {
      const row = this.getDb().prepare(
        `SELECT * FROM active_memory_items WHERE id = ?
         AND (scope != 'temporary' OR expires_at > ?)
         AND (? IS NULL OR scope = ?)`
      ).get(id, Date.now(), options.scope ?? null, options.scope ?? null) as Record<string, unknown> | undefined
      if (!row) {
        unavailableItemIds.push(id)
        continue
      }
      const source = String(row['content_md'])
      const budget = Math.floor((tokenBudget - usedTokenEstimate) / (itemIds.length - hits.length - unavailableItemIds.length))
      const clipped = clipWithTokenBudget(source.slice(offset), budget)
      if (!clipped) {
        continue
      }
      const nextOffset = offset + clipped.content.length
      hits.push({
        id, scope: row['scope'], kind: row['kind'], title: row['title'],
        sourceType: row['source_type'], sourceRef: row['source_ref'],
        createdAt: row['created_at'], updatedAt: row['updated_at'],
        ...(row['scope'] === 'temporary' ? { expiresAt: row['expires_at'] } : {}),
        content: clipped.content, offset,
        nextOffset: nextOffset < source.length ? nextOffset : null,
        truncated: nextOffset < source.length, excerpted: false
      })
      usedTokenEstimate += clipped.tokens
    }

    return { success: true, data: {
      query, tokenBudget, usedTokenEstimate, hits, unavailableItemIds,
      omittedCandidateCount: itemIds.length - hits.length - unavailableItemIds.length,
      facts: []
    } }
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
    const newItemId = randomUUID()
    const scope = this.normalizeScope(options.scope)
    const kind = this.normalizeKind(options.kind)
    const sourceType = scope === 'temporary' ? 'explicit_user' : this.normalizeSourceType(options.sourceType)
    const sessionId = this.executionContext?.conversationSessionId
    let sourceRef = options.sourceRef || (sessionId ? `session:${sessionId}` : null)
    if (scope === 'temporary') {
      const policy = resolveTemporaryMemoryPolicy(this.settings)
      const evidence = options.evidence?.trim()
      if (!sessionId || !evidence) {
        return { success: false, error: 'Temporary memory requires an exact quote from the current owner message.' }
      }
      const archivePath = path.join(PROFILE_SESSIONS_PATH, CONVERSATION_DATABASE_FILENAME)
      let owner: { message: unknown, sentAt: number, messageId?: string } | undefined

      // Evidence must come from current storage, not the preserved migration backup.
      if (fs.existsSync(archivePath)) {
        const archive = new SQLite(archivePath, { readonly: true, fileMustExist: true })
        try {
          const row = archive.prepare(`SELECT payload FROM conversation_messages
            WHERE session_id = ? AND role = 'owner'
            ORDER BY sequence DESC LIMIT 1`).get(sessionId)
          owner = row ? JSON.parse(String(row['payload'])) : undefined
        } finally {
          archive.close()
        }
      } else {
        const log = JSON.parse(await fs.promises.readFile(
          path.join(PROFILE_SESSIONS_PATH, sessionId, 'conversation_log.json'), 'utf8'
        )) as Array<{ who: string, message: unknown, sentAt: number, messageId?: string }>
        owner = log.findLast((message) => message.who === 'owner')
      }
      if (typeof owner?.message !== 'string' || !owner.message.includes(evidence)) {
        return { success: false, error: 'Evidence must occur verbatim in the latest owner message; assistant text and guesses are not evidence.' }
      }
      if (Buffer.byteLength(normalizedContent, 'utf8') > policy.tokenBudget / 2) {
        return { success: false, error: 'Temporary memory must be a concise fact; shorten its content without losing qualifications.' }
      }
      sourceRef = `session:${sessionId}:message:${owner.messageId || owner.sentAt}`
      options = {
        ...options,
        expiresAt: resolveTemporaryExpiration(now, options.expiresAt, policy),
        isPinned: false,
        metadata: { ...options.metadata, evidence }
      }
      if (getTemporaryContextSize([{
        id: newItemId, content: normalizedContent, source: sourceRef, sourceType,
        expiresAt: new Date(options.expiresAt as number).toISOString()
      }]) > policy.tokenBudget) {
        return { success: false, error: 'This fact and its source exceed the temporary context budget. Shorten the content while preserving its meaning.' }
      }
    }
    const dayKey = options.dayKey || toDayKey(now)
    const dedupeHash = createHash('sha256')
      .update(`${scope}|${kind}|${normalizedContent.toLowerCase()}`)
      .digest('hex')

    const { itemId, createdAt, previous } = db.transaction(() => {
      const previous = options.supersedesItemId
        ? db.prepare('SELECT * FROM active_memory_items WHERE id = ?').get(options.supersedesItemId)
        : undefined
      if (options.supersedesItemId && (!previous || previous['scope'] !== scope)) {
        throw new Error('The memory to correct must be active and in the same scope.')
      }

      // Retired content must release its dedupe key without reviving old evidence.
      db.prepare(
        `UPDATE memory_items SET is_deleted = 1, updated_at = ?
         WHERE scope = ? AND dedupe_hash = ? AND is_deleted = 0
           AND NOT EXISTS (
           SELECT 1 FROM active_memory_items AS current_item
           WHERE current_item.id = memory_items.id
         )`
      ).run(now, scope, dedupeHash)

      const existing = db
        .prepare(
          `SELECT * FROM memory_items
           WHERE scope = ? AND dedupe_hash = ? AND is_deleted = 0
           LIMIT 1`
        )
        .get(scope, dedupeHash) as Record<string, unknown> | undefined

      const itemId = existing && typeof existing['id'] === 'string'
        ? String(existing['id'])
        : newItemId

      if (scope === 'temporary' && existing?.['source_ref'] === sourceRef && !options.supersedesItemId) {
        // Retrying the same evidence must not extend its lifetime.
        return { itemId, createdAt: Number(existing['created_at']), previous }
      }

      if (
        existing?.['source_type'] === 'explicit_user' &&
        sourceType === 'inferred' &&
        !options.supersedesItemId
      ) {
        return { itemId, createdAt: Number(existing['created_at']), previous }
      }

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
               supersedes_item_id = COALESCE(?, supersedes_item_id),
               metadata_json = ?
           WHERE id = ?`
        ).run(
          options.title || null,
          normalizedContent,
          normalizedContent,
          existing['source_type'] === 'explicit_user' && sourceType === 'inferred'
            ? existing['source_type'] : sourceType,
          existing['source_type'] === 'explicit_user' && sourceType === 'inferred'
            ? existing['source_ref'] : sourceRef,
          this.normalizeScore(options.importance, 0.5),
          this.normalizeScore(options.confidence, 0.7),
          dayKey,
          now,
          typeof options.expiresAt === 'number' ? options.expiresAt : null,
          options.isPinned ? 1 : 0,
          options.supersedesItemId !== itemId ? options.supersedesItemId || null : null,
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
          sourceRef,
          this.normalizeScore(options.importance, 0.5),
          this.normalizeScore(options.confidence, 0.7),
          dayKey,
          now,
          now,
          typeof options.expiresAt === 'number' ? options.expiresAt : null,
          options.isPinned ? 1 : 0,
          options.supersedesItemId || null,
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

      return { itemId, createdAt: Number(existing?.['created_at'] ?? now), previous }
    })()

    if (previous && previous['id'] !== itemId) {
      await this.writeMarkdownMirror({
        id: String(previous['id']),
        scope,
        kind: this.normalizeKind(previous['kind']),
        title: previous['title'] ? String(previous['title']) : null,
        content: String(previous['content_md']),
        dayKey: String(previous['day_key'] || dayKey),
        createdAt: Number(previous['created_at'])
      })
    }

    await this.writeMarkdownMirror({
      id: itemId,
      scope,
      kind,
      title: options.title || null,
      content: normalizedContent,
      dayKey,
      createdAt
    })

    if (scope !== 'temporary') {
      MemoryTool.lastIndexUpdateAt = 0
      await this.ensureCollections()
      await this.updateIndex()
    }

    return {
      success: true,
      data: {
        id: itemId,
        scope,
        kind,
        title: options.title || null,
        content: normalizedContent,
        createdAt,
        updatedAt: now,
        supersedesItemId: options.supersedesItemId || null,
        expiresAt: db.prepare('SELECT expires_at FROM memory_items WHERE id = ?').get(itemId)?.['expires_at'] ?? null
      }
    }
  }

  /**
   * Retire a selected memory and its derived facts without erasing source transcripts.
   */
  public async forget(id: string): Promise<Record<string, unknown>> {
    await this.ensureStorage()
    const db = this.getDb()
    const record = db.prepare('SELECT * FROM memory_items WHERE id = ?').get(id)
    if (!record) {
      return { success: false, error: 'Memory ID was not found.' }
    }

    db.prepare('UPDATE memory_items SET is_deleted = 1, updated_at = ? WHERE id = ?')
      .run(Date.now(), id)
    await this.writeMarkdownMirror({
      id,
      scope: this.normalizeScope(record['scope']),
      kind: this.normalizeKind(record['kind']),
      title: record['title'] ? String(record['title']) : null,
      content: String(record['content_md']),
      dayKey: String(record['day_key'] || ''),
      createdAt: Number(record['created_at'])
    })
    if (record['scope'] !== 'temporary') {
      MemoryTool.lastIndexUpdateAt = 0
      await this.ensureCollections()
      await this.updateIndex()
    }

    return {
      success: true,
      data: { id, forgotten: true, sourceTranscriptsRetained: true }
    }
  }

  /**
   * Resolve indexed file candidates to current records before ranking or excerpting.
   */
  private resolveMemoryHit(hit: QMDHit): QMDHit[] {
    if (hit.namespace === 'context') {
      return [hit]
    }

    const scope = hit.namespace === 'memory_persistent'
      ? 'persistent'
      : hit.namespace === 'memory_discussion' ? 'discussion' : 'daily'
    const rows = hit.authoritative
      ? this.getDb().prepare('SELECT * FROM active_memory_items WHERE id = ?').all(hit.id)
      : this.readMirrorRecords(scope, path.basename(hit.path, '.md'))

    return rows.map((row) => ({
      ...hit,
      id: String(row['id']),
      title: String(row['title'] || row['kind']),
      content: String(row['content_md']),
      sourceType: String(row['source_type']),
      sourceRef: row['source_ref'] ? String(row['source_ref']) : null,
      scope: this.normalizeScope(row['scope']),
      kind: this.normalizeKind(row['kind']),
      createdAt: Number(row['created_at']), updatedAt: Number(row['updated_at']),
      authoritative: true
    }))
  }

  /**
   * Read the current contents of one persistent or aggregate day projection.
   */
  private readMirrorRecords(scope: MemoryScope, key: string): Record<string, unknown>[] {
    return scope === 'persistent'
      ? this.getDb().prepare('SELECT * FROM active_memory_items WHERE scope = ? AND id = ?').all(scope, key)
      : this.getDb().prepare(
          `SELECT * FROM active_memory_items
           WHERE scope = ? AND day_key = ? ${scope === 'daily' ? 'AND kind = \'summary\'' : ''}
           ORDER BY updated_at DESC ${scope === 'daily' ? 'LIMIT 1' : ''}`
        ).all(scope, key)
  }

  private normalizePositiveInt(value: unknown, fallback: number): number {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback
    }
    return Math.floor(parsed)
  }

  private normalizeScope(value: unknown): MemoryScope {
    if (value === 'daily' || value === 'discussion' || value === 'persistent' || value === 'temporary') {
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
      : 'inferred'
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
      const schemaSQL = await fs.promises.readFile(MEMORY_SCHEMA_PATH, 'utf8')
      if (!MemoryTool.db) {
        const db = new SQLite(PROFILE_MEMORY_DB_PATH)
        try {
          upgradeMemoryScope(db, schemaSQL)
          db.exec(schemaSQL)
          MemoryTool.db = db
        } catch (error) {
          db.close()
          throw error
        }
      }
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

  private readFacts(limit: number): Array<{
    key: string
    text: string
    id: string
    sourceType: string
    sourceRef: string | null
  }> {
    const db = this.getDb()
    const rows = db
      .prepare(
        `SELECT fact_key, canonical_text, source_item_id, source_type, source_ref
         FROM active_memory_facts
         WHERE is_deleted = 0
         ORDER BY priority DESC, updated_at DESC
         LIMIT ?`
      )
      .all(limit) as Array<Record<string, unknown>>

    return rows.map((row) => ({
      key: String(row['fact_key'] || ''),
      id: String(row['source_item_id']),
      sourceType: String(row['source_type']),
      sourceRef: row['source_ref'] ? String(row['source_ref']) : null,
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
    if (input.scope === 'temporary' || (input.scope === 'daily' && input.kind !== 'summary')) {
      return
    }

    const key = input.scope === 'persistent' ? input.id : input.dayKey
    const rows = this.readMirrorRecords(input.scope, key)
    const current = rows[0]
    const date = new Date(input.createdAt)
    const filePath = input.scope === 'persistent'
      ? path.join(
          MEMORY_PERSISTENT_PATH,
          String(date.getUTCFullYear()),
          String(date.getUTCMonth() + 1).padStart(2, '0'),
          String(date.getUTCDate()).padStart(2, '0'),
          `${input.id}.md`
        )
      : path.join(input.scope === 'daily' ? MEMORY_DAILY_PATH : MEMORY_DISCUSSION_PATH, `${input.dayKey}.md`)

    if (!current) {
      await fs.promises.rm(filePath, { force: true })
      return
    }

    const markdown = input.scope === 'persistent'
      ? `> Persistent memory entry (${current['kind']})\n\n# ${current['title'] || current['kind']}\n\nID: ${current['id']}\nCreated At: ${date.toISOString()}\n\n${current['content_md']}\n`
      : input.scope === 'daily'
        ? String(current['content_md'])
        : `> Discussion memory for ${input.dayKey}. Short-term rolling conversation context.\n# ${input.dayKey}\n\n` + rows
            .sort((a, b) => Number(a['created_at']) - Number(b['created_at']))
            .map((row) => `- ${new Date(Number(row['created_at'])).toISOString()} | ${String(row['content_md']).replace(/\n/g, ' | ')}\n`)
            .join('')
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
    await fs.promises.writeFile(filePath, markdown, 'utf8')
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
