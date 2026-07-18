import fs from 'node:fs'
import path from 'node:path'

import { LogHelper } from '@/helpers/log-helper'
import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import {
  type QMDCollectionDefinition,
  type QMDStoreRow,
  QMDWriteLockTimeoutError,
  runQMDStoreSearch,
  updateQMDStore,
  getQMDStore,
  getQMDStoreStatus,
  embedQMDStore
} from '@/core/memory-manager/qmd/qmd-store'
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
  normalizeFilename,
  normalizePath,
  pickStringDeep,
  rankRetrievedHits,
  resolveRequestedCollectionName,
  shouldRunAdaptiveSecondPass
} from '@/core/memory-manager/qmd/qmd-retrieval'

import type {
  KnowledgeNamespace,
  RecallRetrievalMode
} from './types'

const QMD_INDEX_PREFIX = 'leon-memory'
const QMD_UPDATE_MIN_INTERVAL_MS = 5_000
const QMD_EMBED_MIN_INTERVAL_MS = 30_000
const BRIDGE_SOURCE_CONTENT_CAP = 96_000

export interface QMDRecallHit {
  id: string
  path: string
  title: string
  content: string
  score: number
  namespace: KnowledgeNamespace
}

interface QMDQueryInput {
  query: string
  namespaces: KnowledgeNamespace[]
  topK: number
  contextFilenames?: string[]
  retrievalMode?: RecallRetrievalMode
}

type QMDSearchMode = 'query' | 'search'

function createQMDCollections(
  profileName: string
): Record<KnowledgeNamespace, { name: string, dir: string }> {
  const profilePaths = getProfilePaths(profileName)

  return {
    context: {
      name: 'context',
      dir: profilePaths.context
    },
    memory_persistent: {
      name: 'memory-persistent',
      dir: path.join(profilePaths.memory, 'persistent')
    },
    memory_daily: {
      name: 'memory-daily',
      dir: path.join(profilePaths.memory, 'daily')
    },
    memory_discussion: {
      name: 'memory-discussion',
      dir: path.join(profilePaths.memory, 'discussion')
    },
    conversation_daily: {
      name: 'memory-daily',
      dir: path.join(profilePaths.memory, 'daily')
    }
  }
}

function isContextFilenameAllowed(
  allowedFilenames: Set<string>,
  sourcePath: string,
  title: string
): boolean {
  if (allowedFilenames.size === 0) {
    return true
  }

  return (
    allowedFilenames.has(normalizeFilename(sourcePath)) ||
    allowedFilenames.has(normalizeFilename(title))
  )
}

export default class QMDBackend {
  private readonly indexName: string
  private readonly collections: Record<
    KnowledgeNamespace,
    { name: string, dir: string }
  >
  private readonly sdkCollections: QMDCollectionDefinition[]
  private loaded = false
  private lastUpdateAt = 0
  private lastEmbedAt = 0
  private hybridRetrievalEnabled = false
  private embeddingRefreshPromise: Promise<void> | null = null
  private readonly dirtyNamespaces = new Set<KnowledgeNamespace>()

  public constructor(profileName: string) {
    this.indexName = `${QMD_INDEX_PREFIX}-${profileName}`
    this.collections = createQMDCollections(profileName)
    this.sdkCollections = [
      this.collections.context,
      this.collections.memory_persistent,
      this.collections.memory_daily,
      this.collections.memory_discussion
    ]
  }

  public markDirty(namespace: KnowledgeNamespace): void {
    this.dirtyNamespaces.add(namespace)
  }

  public async load(): Promise<void> {
    if (this.loaded) {
      return
    }

    await this.ensureCollections()
    this.loaded = true

    LogHelper.title('Memory Manager')
    LogHelper.success(`QMD backend loaded (index=${this.indexName})`)
  }

  public enableHybridRetrieval(): void {
    if (this.hybridRetrievalEnabled) {
      return
    }

    this.hybridRetrievalEnabled = true
    LogHelper.title('Memory Manager')
    LogHelper.debug('QMD hybrid retrieval enabled after first observed turn')
  }

  public async refresh(force = false): Promise<void> {
    await this.load()

    const now = Date.now()
    if (!force && this.dirtyNamespaces.size === 0) {
      return
    }

    if (!force && now - this.lastUpdateAt < QMD_UPDATE_MIN_INTERVAL_MS) {
      return
    }

    try {
      await updateQMDStore({
        indexName: this.indexName,
        collections: this.sdkCollections,
        collectionNames: [...new Set(
          [...this.dirtyNamespaces]
            .map((namespace) => this.collections[namespace]?.name)
            .filter((name): name is string => Boolean(name))
        )]
      })
      this.lastUpdateAt = now
      this.dirtyNamespaces.clear()

      LogHelper.title('Memory Manager')
      LogHelper.debug('QMD index refreshed')
    } catch (error) {
      if (error instanceof QMDWriteLockTimeoutError) {
        LogHelper.title('Memory Manager')
        LogHelper.warning(
          `QMD refresh skipped because another process is updating the index; continuing with the current index snapshot. ${error.message}`
        )
        return
      }

      throw error
    }
  }

  public async query(input: QMDQueryInput): Promise<QMDRecallHit[]> {
    await this.refresh()
    const retrievalMode = input.retrievalMode || 'hybrid'
    const allowSemanticSearch =
      retrievalMode === 'hybrid' && this.hybridRetrievalEnabled

    if (allowSemanticSearch) {
      await this.ensureEmbeddings()
    }

    const uniqueNamespaces = [...new Set(input.namespaces)]
    if (uniqueNamespaces.length === 0) {
      return []
    }

    const perNamespaceLimit = Math.max(input.topK * 3, input.topK)
    const collectionNames = [
      ...new Set(
        uniqueNamespaces
          .map((namespace) => this.collections[namespace]?.name)
          .filter((name): name is string => Boolean(name))
      )
    ]
    if (collectionNames.length === 0) {
      return []
    }
    const globalLimit = Math.max(
      input.topK,
      perNamespaceLimit * collectionNames.length
    )
    const allowedContextFilenames = new Set(
      (input.contextFilenames || []).map((filename) => normalizeFilename(filename))
    )
    const namespaceByCollection = new Map<string, KnowledgeNamespace[]>(
      collectionNames.map((collectionName) => {
        const mappedNamespaces = uniqueNamespaces.filter(
          (namespace) => this.collections[namespace]?.name === collectionName
        )
        return [collectionName, mappedNamespaces]
      })
    )
    const collectionPathByName = new Map<string, string>(
      collectionNames.map((collectionName) => {
        const definition = Object.values(this.collections).find(
          (entry) => entry.name === collectionName
        )
        return [collectionName, definition?.dir || '']
      })
    )

    const queryTokens = buildQueryTokenSet(input.query)
    const hits: QMDRecallHit[] = []

    const runPreferredSearchModes = async (
      bridgeTerms: string[],
      scopedCollectionNames: string[],
      limit: number
    ): Promise<{
      rows: QMDStoreRow[]
      modeUsed: QMDSearchMode
    }> => {
      const lexicalQuery = buildLexicalSearchQuery(input.query, bridgeTerms)
      if (retrievalMode === 'lexical') {
        return {
          rows: await this.runQMDSearchMode(
            'search',
            lexicalQuery,
            scopedCollectionNames,
            limit
          ),
          modeUsed: 'search'
        }
      }

      let rows = await this.runQMDSearchMode(
        'query',
        buildExpansionQuery(input.query, bridgeTerms),
        scopedCollectionNames,
        limit
      )
      if (rows.length > 0) {
        return {
          rows,
          modeUsed: 'query'
        }
      }

      rows = await this.runQMDSearchMode(
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

    const appendRows = (
      rowsToAppend: Array<Record<string, unknown>>,
      modeUsed: QMDSearchMode
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

        const explicitCollection = resolveRequestedCollectionName(
          pickStringDeep(row, ['collection', 'collection_name', 'collectionName']),
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
          explicitCollection ||
          collectionFromQmdPath ||
          collectionFromAbsolutePath ||
          (collectionNames.length === 1 ? (collectionNames[0] || '') : '')

        const mappedNamespaces = namespaceByCollection.get(resolvedCollectionName) || []
        const resolvedNamespace =
          uniqueNamespaces.find((namespace) => mappedNamespaces.includes(namespace)) ||
          (uniqueNamespaces.length === 1 ? uniqueNamespaces[0] : null)
        if (!resolvedNamespace) {
          continue
        }

        if (
          resolvedNamespace === 'context' &&
          !isContextFilenameAllowed(allowedContextFilenames, sourcePath, title)
        ) {
          continue
        }

        hits.push({
          id,
          path: sourcePath,
          title,
          content,
          score: extractScore(row) + (modeUsed === 'query' ? 0.03 : 0.01),
          namespace: resolvedNamespace
        })
      }
    }

    const rankHitsByQuery = (
      hitsInput: QMDRecallHit[]
    ): Array<{ hit: QMDRecallHit, rankingScore: number, overlapCount: number }> => {
      return rankRetrievedHits(
        hitsInput,
        queryTokens,
        this.collections,
        namespaceWeights,
        BRIDGE_SOURCE_CONTENT_CAP
      )
    }
    const namespaceWeights: Partial<Record<KnowledgeNamespace, number>> = {
      ...DEFAULT_QMD_NAMESPACE_WEIGHTS
    }

    const hasPersistentHit = (): boolean =>
      hits.some((hit) => hit.namespace === 'memory_persistent')
    const retrievalStages: string[] = []
    const rewrittenQueries: string[] = []

    let rows: QMDStoreRow[] = []
    let modeUsed: QMDSearchMode | null = null

    if (allowSemanticSearch) {
      try {
        const result = await runPreferredSearchModes(
          [],
          collectionNames,
          globalLimit
        )
        rows = result.rows
        modeUsed = result.modeUsed
        retrievalStages.push(`initial:${modeUsed}:${rows.length}`)
      } catch (error) {
        LogHelper.title('Memory Manager')
        LogHelper.warning(
          `QMD preferred search failed for collections=${collectionNames.join(', ')}: ${String(error)}`
        )
      }
    } else {
      LogHelper.title('Memory Manager')
      LogHelper.debug(
        retrievalMode === 'lexical'
          ? 'QMD retrieval mode: search-only (lexical requested)'
          : 'QMD cold-start retrieval mode: search-only (hybrid deferred)'
      )
    }

    if (rows.length === 0) {
      try {
        rows = await this.runQMDSearchMode(
          'search',
          buildLexicalSearchQuery(input.query),
          collectionNames,
          globalLimit
        )
        modeUsed = 'search'
        retrievalStages.push(`fallback:search:${rows.length}`)
      } catch (error) {
        LogHelper.title('Memory Manager')
        LogHelper.warning(
          `QMD search fallback failed for collections=${collectionNames.join(', ')}: ${String(error)}`
        )
      }
    }

    if (modeUsed) {
      appendRows(rows, modeUsed)
    }

    let rankedHits = rankHitsByQuery(hits)
    if (!hasPersistentHit() || shouldRunAdaptiveSecondPass(rankedHits)) {
      try {
        const enrichmentRows = await this.runQMDSearchMode(
          'search',
          buildLexicalSearchQuery(input.query),
          collectionNames,
          globalLimit
        )
        appendRows(enrichmentRows, 'search')
        retrievalStages.push(`enrich:search:${enrichmentRows.length}`)
      } catch (error) {
        LogHelper.title('Memory Manager')
        LogHelper.warning(
          `QMD enrichment search failed for collections=${collectionNames.join(', ')}: ${String(error)}`
        )
      }

      const missingNamespaces = uniqueNamespaces.filter(
        (namespace) => !hits.some((hit) => hit.namespace === namespace)
      )
      for (const missingNamespace of missingNamespaces) {
        const collectionName = this.collections[missingNamespace]?.name
        if (!collectionName) {
          continue
        }

        try {
          appendRows(
            await this.runQMDSearchMode(
              'search',
              buildLexicalSearchQuery(input.query),
              [collectionName],
              perNamespaceLimit
            ),
            'search'
          )
        } catch (error) {
          LogHelper.title('Memory Manager')
          LogHelper.warning(
            `QMD scoped enrichment failed for collection=${collectionName}: ${String(error)}`
          )
        }
      }

      rankedHits = rankHitsByQuery(hits)
    }

    let secondPassSupportTokens: string[] = []
    if (!hasPersistentHit() || shouldRunAdaptiveSecondPass(rankedHits)) {
      const secondPass = buildDiscriminativeSecondPass(
        input.query,
        queryTokens,
        rankedHits.map((rankedHit) => rankedHit.hit),
        this.collections,
        BRIDGE_SOURCE_CONTENT_CAP
      )

      if (secondPass) {
        secondPassSupportTokens = secondPass.bridgeTokens
        rewrittenQueries.push(`second_pass=${JSON.stringify(secondPass.lexicalQuery)}`)

        try {
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

          const stillMissingNamespaces = uniqueNamespaces.filter(
            (namespace) => !hits.some((hit) => hit.namespace === namespace)
          )
          for (const missingNamespace of stillMissingNamespaces) {
            const collectionName = this.collections[missingNamespace]?.name
            if (!collectionName) {
              continue
            }

            try {
              appendRows(
                await this.runQMDSearchMode(
                  'search',
                  buildLexicalSearchQuery(input.query, secondPass.bridgeTokens),
                  [collectionName],
                  perNamespaceLimit
                ),
                'search'
              )
            } catch (error) {
              LogHelper.title('Memory Manager')
              LogHelper.warning(
                `QMD scoped second-pass failed for collection=${collectionName}: ${String(error)}`
              )
            }
          }

          rankedHits = rankHitsByQuery(hits)
        } catch (error) {
          LogHelper.title('Memory Manager')
          LogHelper.warning(
            `QMD second-pass failed for collections=${collectionNames.join(', ')}: ${String(error)}`
          )
        }
      }
    }

    let rescueSupportTokens: string[] = []
    const rescueBridgeTokens = buildHydratedRescueBridgeTokens(
      queryTokens,
      rankedHits,
      this.collections,
      BRIDGE_SOURCE_CONTENT_CAP
    ).filter((token) => !secondPassSupportTokens.includes(token))

    if (rescueBridgeTokens.length > 0) {
      rescueSupportTokens = rescueBridgeTokens
      rewrittenQueries.push(
        `rescue=${JSON.stringify(buildLexicalSearchQuery(input.query, rescueBridgeTokens))}`
      )

      try {
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

        const stillMissingNamespaces = uniqueNamespaces.filter(
          (namespace) => !hits.some((hit) => hit.namespace === namespace)
        )
        for (const missingNamespace of stillMissingNamespaces) {
          const collectionName = this.collections[missingNamespace]?.name
          if (!collectionName) {
            continue
          }

          try {
            appendRows(
              await this.runQMDSearchMode(
                'search',
                buildLexicalSearchQuery(input.query, rescueBridgeTokens),
                [collectionName],
                perNamespaceLimit
              ),
              'search'
            )
          } catch (error) {
            LogHelper.title('Memory Manager')
            LogHelper.warning(
              `QMD scoped hydrated-rescue failed for collection=${collectionName}: ${String(error)}`
            )
          }
        }

        rankedHits = rankHitsByQuery(hits)
      } catch (error) {
        LogHelper.title('Memory Manager')
        LogHelper.warning(
          `QMD hydrated-rescue failed for collections=${collectionNames.join(', ')}: ${String(error)}`
        )
      }
    }

    const backtrackCandidates = buildHydratedBacktrackCandidates(
      queryTokens,
      rankedHits,
      this.collections,
      namespaceWeights,
      BRIDGE_SOURCE_CONTENT_CAP
    )
    const existingHitPaths = new Set(hits.map((hit) => `${hit.namespace}|${hit.path}`))
    const appendedBacktrackHits = backtrackCandidates
      .filter((candidate) => !existingHitPaths.has(
        `${candidate.hit.namespace}|${candidate.hit.path}`
      ))
      .slice(0, 4)

    if (appendedBacktrackHits.length > 0) {
      for (const candidate of appendedBacktrackHits) {
        hits.push({
          ...candidate.hit,
          score: Math.max(candidate.hit.score, candidate.rankingScore)
        })
      }
      retrievalStages.push(`backtrack:local:${appendedBacktrackHits.length}`)
      rankedHits = rankHitsByQuery(hits)
    }

    const excerptQueryTokens = buildAdaptiveQueryTokenSet(
      queryTokens,
      rankedHits.map((rankedHit) => rankedHit.hit),
      this.collections,
      BRIDGE_SOURCE_CONTENT_CAP
    )

    const supportTokens = buildFinalSupportTokens(
      excerptQueryTokens,
      rankedHits,
      this.collections,
      BRIDGE_SOURCE_CONTENT_CAP,
      [...secondPassSupportTokens, ...rescueSupportTokens]
    )

    const output = rankedHits.map((rankedHit) => ({
      ...rankedHit.hit,
      score: Math.max(rankedHit.hit.score, rankedHit.rankingScore),
      content: buildFocusedHitContent(
        rankedHit.hit,
        excerptQueryTokens,
        supportTokens,
        this.collections,
        BRIDGE_SOURCE_CONTENT_CAP
      )
    }))

    if (
      uniqueNamespaces.includes('context') &&
      !output.some((hit) => hit.namespace === 'context')
    ) {
      LogHelper.title('Memory Manager')
      LogHelper.debug(
        'QMD returned no context candidates for this query; planning may rely on memory-only hits'
      )
    }
    LogHelper.title('Memory Manager')
    LogHelper.debug(
      `QMD retrieval stages=${retrievalStages.join(' -> ')} final_hits=${output.length}`
    )
    if (rewrittenQueries.length > 0) {
      LogHelper.title('Memory Manager')
      LogHelper.debug(`QMD retrieval rewritten ${rewrittenQueries.join(' | ')}`)
    }

    return output
  }

  private async ensureCollections(): Promise<void> {
    await Promise.all(
      this.sdkCollections.map((collection) =>
        fs.promises.mkdir(collection.dir, { recursive: true })
      )
    )
    await getQMDStore(this.indexName, this.sdkCollections)

    this.markDirty('context')
    this.markDirty('memory_persistent')
    this.markDirty('memory_daily')
    this.markDirty('memory_discussion')
  }

  private async ensureEmbeddings(force = false): Promise<void> {
    const now = Date.now()
    if (!force && now - this.lastEmbedAt < QMD_EMBED_MIN_INTERVAL_MS) {
      return
    }

    if (this.embeddingRefreshPromise) {
      await this.embeddingRefreshPromise
      return
    }

    this.embeddingRefreshPromise = (async (): Promise<void> => {
      try {
        const status = await getQMDStoreStatus({
          indexName: this.indexName,
          collections: this.sdkCollections
        })
        const pendingEmbeddingCount = status.needsEmbedding

        if (pendingEmbeddingCount <= 0) {
          this.lastEmbedAt = Date.now()
          return
        }

        LogHelper.title('Memory Manager')
        LogHelper.debug(
          `QMD embeddings pending: ${pendingEmbeddingCount}. Running embed refresh...`
        )
        await embedQMDStore({
          indexName: this.indexName,
          collections: this.sdkCollections
        })
        this.lastEmbedAt = Date.now()

        LogHelper.title('Memory Manager')
        LogHelper.debug('QMD embeddings refreshed')
      } catch (error) {
        this.lastEmbedAt = Date.now()
        LogHelper.title('Memory Manager')
        LogHelper.warning(`QMD embedding refresh failed: ${String(error)}`)
      } finally {
        this.embeddingRefreshPromise = null
      }
    })()

    await this.embeddingRefreshPromise
  }

  private async runQMDSearchMode(
    mode: QMDSearchMode,
    query: string,
    collectionNames: string[],
    limit: number
  ): Promise<QMDStoreRow[]> {
    LogHelper.title('Memory Manager')
    LogHelper.debug(
      `QMD store search: mode=${mode} collections=${collectionNames.join(', ')} limit=${limit} query=${JSON.stringify(query)}`
    )

    return runQMDStoreSearch({
      indexName: this.indexName,
      collections: this.sdkCollections,
      mode,
      query,
      collectionNames,
      limit
    })
  }
}
