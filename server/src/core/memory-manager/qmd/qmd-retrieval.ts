import fs from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'

export interface QMDCollectionSpec {
  name: string
  dir: string
}

export interface RetrievedHit<TNamespace extends string = string> {
  id: string
  path: string
  title: string
  content: string
  score: number
  namespace: TNamespace
}

export interface RankedRetrievedHit<TNamespace extends string = string> {
  hit: RetrievedHit<TNamespace>
  rankingScore: number
  overlapCount: number
}

export const DEFAULT_QMD_NAMESPACE_WEIGHTS = {
  memory_persistent: 1.08,
  memory_daily: 1.02,
  memory_discussion: 1,
  conversation_daily: 1.02,
  context: 0.92
} as const

export function normalizeContent(content: string): string {
  return content.replace(/\r\n/g, '\n').trim()
}

export function normalizeFilename(filePath: string): string {
  return path.basename(filePath).toUpperCase()
}

export function normalizePath(value: string): string {
  if (!value) {
    return ''
  }

  if (!value.startsWith('file://')) {
    return value
  }

  try {
    return decodeURIComponent(new URL(value).pathname)
  } catch {
    return value
  }
}

export function resolveRequestedCollectionName(
  value: string,
  collectionNames: string[]
): string {
  const normalizedValue = value.trim().toLowerCase()
  if (!normalizedValue || normalizedValue === 'default') {
    return ''
  }

  return (
    collectionNames.find(
      (collectionName) => collectionName.toLowerCase() === normalizedValue
    ) || ''
  )
}

export function tokenizeQuery(value: string): string[] {
  return (
    value
      .normalize('NFKC')
      .toLowerCase()
      .match(/\p{L}[\p{L}\p{M}\p{N}_-]*|\p{N}+/gu) || []
  )
    .map((token) => token.trim())
    .filter(Boolean)
}

export function tokenLength(token: string): number {
  return [...token].length
}

function sanitizeQmdQueryLine(value: string): string {
  return value
    .replace(/"/g, '\'')
    .replace(/\s+/g, ' ')
    .trim()
}

function dedupeStable(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function trimDoubledConsonant(value: string): string {
  return /([b-df-hj-np-tv-z])\1$/i.test(value)
    ? value.slice(0, -1)
    : value
}

function restoreTrailingE(value: string): string {
  if (!value || value.endsWith('e') || /[aeiou]$/i.test(value)) {
    return value
  }

  return `${value}e`
}

function buildTokenVariants(token: string): string[] {
  const normalized = sanitizeQmdQueryLine(token).toLowerCase()
  if (!normalized) {
    return []
  }

  const variants = new Set<string>([normalized])
  const addVariant = (value: string): void => {
    const candidate = sanitizeQmdQueryLine(value).toLowerCase()
    if (candidate && tokenLength(candidate) >= 3) {
      variants.add(candidate)
    }
  }

  if (normalized.endsWith('ies') && normalized.length > 4) {
    addVariant(`${normalized.slice(0, -3)}y`)
  }

  if (normalized.endsWith('ves') && normalized.length > 4) {
    addVariant(normalized.slice(0, -1))
    addVariant(`${normalized.slice(0, -3)}fe`)
  }

  if (
    normalized.endsWith('s') &&
    normalized.length > 4 &&
    !normalized.endsWith('ss') &&
    !normalized.endsWith('us') &&
    !normalized.endsWith('is')
  ) {
    addVariant(normalized.slice(0, -1))
  }

  if (normalized.endsWith('ing') && normalized.length > 5) {
    const stem = normalized.slice(0, -3)
    const trimmedStem = trimDoubledConsonant(stem)
    addVariant(stem)
    addVariant(trimmedStem)
    addVariant(restoreTrailingE(stem))
    addVariant(restoreTrailingE(trimmedStem))
  }

  if (normalized.endsWith('ed') && normalized.length > 4) {
    const stem = normalized.slice(0, -2)
    const trimmedStem = trimDoubledConsonant(stem)
    addVariant(stem)
    addVariant(trimmedStem)
    addVariant(restoreTrailingE(stem))
    addVariant(restoreTrailingE(trimmedStem))
  }

  return [...variants]
}

function splitQuerySegments(value: string): string[] {
  return value
    .split(/[\n,;:(){}[\]|]+/g)
    .map((segment) => sanitizeQmdQueryLine(segment))
    .filter(Boolean)
}

function normalizeSegmentTerms(value: string): string {
  const uniqueTokens = dedupeStable(
    tokenizeQuery(value)
      .filter((token) => tokenLength(token) >= 3)
      .flatMap((token) => buildTokenVariants(token))
  )

  if (uniqueTokens.length === 0) {
    return sanitizeQmdQueryLine(value)
  }

  return uniqueTokens.join(' ')
}

export function buildExpansionQuery(
  originalQuery: string,
  bridgeTerms: string[] = []
): string {
  const normalizedOriginalQuery = sanitizeQmdQueryLine(originalQuery)
  const normalizedBridgeTerms = dedupeStable(
    bridgeTerms.map((term) => sanitizeQmdQueryLine(term))
  )

  if (!normalizedOriginalQuery && normalizedBridgeTerms.length === 0) {
    return ''
  }

  const segmentEntries = splitQuerySegments(normalizedOriginalQuery)
    .map((segment) => {
      const normalizedSegment = normalizeSegmentTerms(segment)
      const tokenCount = tokenizeQuery(normalizedSegment).length

      return {
        segment: normalizedSegment,
        tokenCount,
        score:
          tokenCount * 2 +
          Math.min(24, normalizedSegment.length) / 24
      }
    })
    .filter((entry) => entry.segment && entry.tokenCount > 0)
    .sort((entryA, entryB) => entryB.score - entryA.score)

  const selectedSegments = dedupeStable(
    [
      normalizedOriginalQuery,
      ...segmentEntries.map((entry) => entry.segment).slice(0, 5),
      ...normalizedBridgeTerms
    ].filter(Boolean)
  )

  return selectedSegments.join('; ')
}

export function buildLexicalSearchQuery(
  originalQuery: string,
  bridgeTerms: string[] = []
): string {
  const normalizedBridgeTerms = dedupeStable(
    bridgeTerms.map((term) => normalizeSegmentTerms(term))
  )
  const normalizedSegments = dedupeStable(
    splitQuerySegments(originalQuery).map((segment) => normalizeSegmentTerms(segment))
  )

  return [...normalizedSegments, ...normalizedBridgeTerms]
    .filter((segment) => tokenizeQuery(segment).length > 0)
    .join(' ')
    .trim()
}

export function pickStringDeep(
  row: Record<string, unknown>,
  keys: string[]
): string {
  const queue: unknown[] = [row]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) {
      continue
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        queue.push(item)
      }
      continue
    }

    if (typeof current !== 'object') {
      continue
    }

    const objectValue = current as Record<string, unknown>
    for (const key of keys) {
      const value = objectValue[key]
      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }
    }

    for (const value of Object.values(objectValue)) {
      if (value && typeof value === 'object') {
        queue.push(value)
      }
    }
  }

  return ''
}

export function pickNumberDeep(
  row: Record<string, unknown>,
  keys: string[]
): number {
  const queue: unknown[] = [row]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) {
      continue
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        queue.push(item)
      }
      continue
    }

    if (typeof current !== 'object') {
      continue
    }

    const objectValue = current as Record<string, unknown>
    for (const key of keys) {
      const value = objectValue[key]
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value
      }
      if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value)
        if (Number.isFinite(parsed)) {
          return parsed
        }
      }
    }

    for (const value of Object.values(objectValue)) {
      if (value && typeof value === 'object') {
        queue.push(value)
      }
    }
  }

  return 0
}

export function extractContent(row: Record<string, unknown>): string {
  const direct = pickStringDeep(row, [
    'snippet',
    'content',
    'text',
    'context',
    'body'
  ])
  if (direct) {
    return direct
  }

  const listKeys = ['snippets', 'chunks', 'matches', 'contexts', 'passages']
  for (const key of listKeys) {
    const value = row[key]
    if (!Array.isArray(value)) {
      continue
    }

    const lines: string[] = []
    for (const item of value) {
      if (typeof item === 'string' && item.trim()) {
        lines.push(item.trim())
        continue
      }

      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const nested = pickStringDeep(item as Record<string, unknown>, [
          'snippet',
          'content',
          'text',
          'context',
          'body'
        ])
        if (nested) {
          lines.push(nested)
        }
      }
    }

    if (lines.length > 0) {
      return lines.join('\n')
    }
  }

  return ''
}

export function extractScore(row: Record<string, unknown>): number {
  const score = pickNumberDeep(row, [
    'score',
    'fused_score',
    'final_score',
    'rank_score'
  ])
  if (score !== 0) {
    return score
  }

  const distance = pickNumberDeep(row, ['distance', 'cosine_distance'])
  if (distance > 0) {
    return 1 / (1 + distance)
  }

  return 0
}

export function buildHitText<TNamespace extends string>(
  hit: RetrievedHit<TNamespace>,
  maxChars = 4_000
): string {
  return `${hit.title} ${path.basename(hit.path || '')} ${hit.content.slice(0, maxChars)}`
}

function canHydrateBridgeSource(namespace: string): boolean {
  return (
    namespace === 'memory_persistent' ||
    namespace === 'memory_daily' ||
    namespace === 'memory_discussion' ||
    namespace === 'conversation_daily'
  )
}

function canBacktrackTemporalSource(namespace: string): boolean {
  return (
    namespace === 'memory_daily' ||
    namespace === 'memory_discussion' ||
    namespace === 'conversation_daily'
  )
}

function buildQmdSourcePath(collectionName: string, relativePath: string): string {
  return `qmd://${collectionName}/${relativePath.replace(/\\/g, '/')}`
}

function isLikelyPersistentMetadataLine(line: string): boolean {
  const trimmedLine = line.trim()
  if (!trimmedLine) {
    return true
  }

  if (trimmedLine.startsWith('#') || trimmedLine.startsWith('>')) {
    return true
  }

  const separatorIndex = trimmedLine.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex > 32) {
    return false
  }

  const key = trimmedLine.slice(0, separatorIndex).trim()
  if (!key || key.split(/\s+/).length > 4) {
    return false
  }

  return /^[\p{L}\p{N}_ -]+$/u.test(key)
}

function buildSemanticLines<TNamespace extends string>(
  hit: RetrievedHit<TNamespace>
): string[] {
  const lines = hit.content
    .split('\n')
    .flatMap((line: string) => line.split('|'))
    .map((line: string) => line.trim())
    .filter(Boolean)

  if (String(hit.namespace) !== 'memory_persistent') {
    return lines
  }

  const semanticLines = lines.filter(
    (line) => !isLikelyPersistentMetadataLine(line)
  )

  return semanticLines.length > 0 ? semanticLines : lines
}

function computeQuestionPenalty<TNamespace extends string>(
  hit: RetrievedHit<TNamespace>
): number {
  const namespace = String(hit.namespace)
  if (namespace === 'memory_persistent' || namespace === 'context') {
    return 0
  }

  const semanticLines = buildSemanticLines(hit)
  if (semanticLines.length === 0) {
    return 0
  }

  const questionLineCount = semanticLines.filter((line) =>
    line.includes('?')
  ).length
  if (questionLineCount === 0) {
    return 0
  }

  return Math.min(0.18, (questionLineCount / semanticLines.length) * 0.14)
}

function focusCandidateTextAroundQuery(
  text: string,
  queryTokens: Set<string>,
  maxChars = 360
): string {
  if (text.length <= maxChars || queryTokens.size === 0) {
    return text
  }

  const normalizedText = text.toLowerCase()
  let bestIndex = Number.POSITIVE_INFINITY

  for (const token of queryTokens) {
    const tokenIndex = normalizedText.indexOf(token.toLowerCase())
    if (tokenIndex >= 0) {
      bestIndex = Math.min(bestIndex, tokenIndex)
    }
  }

  if (!Number.isFinite(bestIndex)) {
    return text.slice(0, maxChars).trim()
  }

  const start = Math.max(0, bestIndex - Math.floor(maxChars * 0.25))
  const end = Math.min(text.length, start + maxChars)
  const prefix = start > 0 ? '... ' : ''
  const suffix = end < text.length ? ' ...' : ''

  return `${prefix}${text.slice(start, end).trim()}${suffix}`.trim()
}

export function buildQueryTokenSet(query: string): Set<string> {
  const rawQueryTokens = tokenizeQuery(query)
  const informativeQueryTokens = rawQueryTokens.filter(
    (token) => tokenLength(token) >= 3
  )

  return new Set(
    informativeQueryTokens.length > 0
      ? informativeQueryTokens
      : rawQueryTokens
  )
}

function buildRankingContent<TNamespace extends string>(
  hit: RetrievedHit<TNamespace>
): string {
  const semanticLines = buildSemanticLines(hit)
  if (semanticLines.length === 0) {
    return hit.content
  }

  const nonQuestionLines = semanticLines.filter((line) => !line.includes('?'))
  const preferredLines =
    nonQuestionLines.length > 0 ? nonQuestionLines : semanticLines

  return preferredLines.join(' ')
}

function buildRankingHitText<TNamespace extends string>(
  hit: RetrievedHit<TNamespace>,
  collections: Record<TNamespace, QMDCollectionSpec>,
  bridgeSourceContentCap: number
): string {
  const hydratedHit = hydrateBridgeSeedHit(
    hit,
    collections,
    bridgeSourceContentCap
  )

  return `${hydratedHit.title} ${path.basename(hydratedHit.path || '')} ${buildRankingContent(hydratedHit).slice(0, 12_000)}`.trim()
}

export function extractOverlapCount<TNamespace extends string>(
  queryTokens: Set<string>,
  hit: RetrievedHit<TNamespace>,
  collections: Record<TNamespace, QMDCollectionSpec>,
  bridgeSourceContentCap: number
): number {
  if (queryTokens.size === 0) {
    return 0
  }

  const hitTokens = new Set(
    tokenizeQuery(buildRankingHitText(hit, collections, bridgeSourceContentCap))
      .flatMap((token) => buildTokenVariants(token))
  )
  if (hitTokens.size === 0) {
    return 0
  }

  let overlapCount = 0
  for (const token of queryTokens) {
    if (buildTokenVariants(token).some((variant) => hitTokens.has(variant))) {
      overlapCount += 1
    }
  }

  return overlapCount
}

export function buildAdaptiveQueryTokenSet<TNamespace extends string>(
  queryTokens: Set<string>,
  hits: RetrievedHit<TNamespace>[],
  collections: Record<TNamespace, QMDCollectionSpec>,
  bridgeSourceContentCap: number
): Set<string> {
  if (queryTokens.size === 0 || hits.length === 0) {
    return queryTokens
  }

  const hitCount = hits.length
  const tokenDocumentFrequency = new Map<string, number>()
  for (const token of queryTokens) {
    tokenDocumentFrequency.set(token, 0)
  }

  for (const hit of hits) {
    const hitTokens = new Set(
      tokenizeQuery(buildRankingHitText(hit, collections, bridgeSourceContentCap))
    )
    for (const token of queryTokens) {
      if (hitTokens.has(token)) {
        tokenDocumentFrequency.set(
          token,
          (tokenDocumentFrequency.get(token) || 0) + 1
        )
      }
    }
  }

  const adaptiveTokens = new Set<string>()
  for (const token of queryTokens) {
    const frequency = tokenDocumentFrequency.get(token) || 0
    if (frequency / hitCount >= 0.85) {
      continue
    }

    adaptiveTokens.add(token)
  }

  return adaptiveTokens.size > 0 ? adaptiveTokens : queryTokens
}

function computeLexicalBoost<TNamespace extends string>(
  queryTokens: Set<string>,
  hit: RetrievedHit<TNamespace>,
  collections: Record<TNamespace, QMDCollectionSpec>,
  bridgeSourceContentCap: number
): number {
  if (queryTokens.size === 0) {
    return 0
  }

  const hitTokens = new Set(
    tokenizeQuery(buildRankingHitText(hit, collections, bridgeSourceContentCap))
  )
  if (hitTokens.size === 0) {
    return 0
  }

  const overlapCount = extractOverlapCount(
    queryTokens,
    hit,
    collections,
    bridgeSourceContentCap
  )
  if (overlapCount === 0) {
    return 0
  }

  const coverage = overlapCount / queryTokens.size
  const density = overlapCount / Math.max(8, Math.min(32, hitTokens.size))

  return coverage * 1.35 + density * 0.35
}

function computeRecencyBoost<TNamespace extends string>(
  hit: RetrievedHit<TNamespace>
): number {
  const namespace = String(hit.namespace)
  if (
    namespace !== 'memory_daily' &&
    namespace !== 'memory_discussion' &&
    namespace !== 'conversation_daily'
  ) {
    return 0
  }

  const basename = path.basename(hit.path || '')
  const dayKeyMatch = basename.match(/^(\d{4}-\d{2}-\d{2})\.md(?:\.gz)?$/i)
  if (!dayKeyMatch?.[1]) {
    return 0
  }

  const dayTs = Date.parse(`${dayKeyMatch[1]}T00:00:00.000Z`)
  if (!Number.isFinite(dayTs)) {
    return 0
  }

  const ageDays = Math.max(0, (Date.now() - dayTs) / (24 * 60 * 60 * 1_000))
  if (ageDays <= 7) {
    return 0.14
  }
  if (ageDays <= 30) {
    return 0.08
  }

  return 0
}

export function rankRetrievedHits<TNamespace extends string>(
  hitsInput: RetrievedHit<TNamespace>[],
  queryTokens: Set<string>,
  collections: Record<TNamespace, QMDCollectionSpec>,
  namespaceWeights: Partial<Record<TNamespace, number>> = {},
  bridgeSourceContentCap = 96_000
): RankedRetrievedHit<TNamespace>[] {
  const deduped = new Map<string, RetrievedHit<TNamespace>>()
  for (const hit of hitsInput) {
    const key = `${hit.namespace}|${hit.path}|${hit.content}`
    const existing = deduped.get(key)
    if (!existing || hit.score > existing.score) {
      deduped.set(key, hit)
    }
  }

  const dedupedHits = [...deduped.values()]
  const adaptiveQueryTokens = buildAdaptiveQueryTokenSet(
    queryTokens,
    dedupedHits,
    collections,
    bridgeSourceContentCap
  )

  return dedupedHits
    .map((hit) => {
      const weight = namespaceWeights[hit.namespace] ?? 1
      const overlapCount = extractOverlapCount(
        adaptiveQueryTokens,
        hit,
        collections,
        bridgeSourceContentCap
      )
      const rankingScore =
        hit.score * weight +
        computeLexicalBoost(
          adaptiveQueryTokens,
          hit,
          collections,
          bridgeSourceContentCap
        ) +
        computeRecencyBoost(hit) -
        computeQuestionPenalty(hit)

      return {
        hit,
        overlapCount,
        rankingScore
      }
    })
    .sort((entryA, entryB) => entryB.rankingScore - entryA.rankingScore)
}

function clipBridgeSourceContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content
  }

  const sideChars = Math.max(0, Math.floor((maxChars - 8) / 2))
  return `${content.slice(0, sideChars)}\n...\n${content.slice(-sideChars)}`
}

function resolveBridgeSourceFilePath<TNamespace extends string>(
  sourcePath: string,
  collections: Record<TNamespace, QMDCollectionSpec>
): string {
  const normalizedSourcePath = normalizePath(sourcePath)
  if (!normalizedSourcePath) {
    return ''
  }

  if (path.isAbsolute(normalizedSourcePath)) {
    return normalizedSourcePath
  }

  const qmdPathMatch = normalizedSourcePath.match(/^qmd:\/\/([^/]+)\/(.+)$/i)
  if (!qmdPathMatch?.[1] || !qmdPathMatch[2]) {
    return ''
  }

  const collectionSpecs = Object.values(collections) as QMDCollectionSpec[]
  const collectionName = resolveRequestedCollectionName(
    qmdPathMatch[1],
    [...new Set(collectionSpecs.map((collection) => collection.name))]
  )
  if (!collectionName) {
    return ''
  }

  const collectionDir = collectionSpecs.find(
    (collection) => collection.name === collectionName
  )?.dir
  if (!collectionDir) {
    return ''
  }

  const resolvedCollectionDir = path.resolve(collectionDir)
  const resolvedSourcePath = path.resolve(resolvedCollectionDir, qmdPathMatch[2])
  if (
    resolvedSourcePath !== resolvedCollectionDir &&
    !resolvedSourcePath.startsWith(`${resolvedCollectionDir}${path.sep}`)
  ) {
    return ''
  }

  return resolvedSourcePath
}

function readBridgeSourceContent(sourceFilePath: string): string {
  const sourceBuffer = fs.readFileSync(sourceFilePath)

  return normalizeContent(
    sourceFilePath.endsWith('.gz')
      ? gunzipSync(sourceBuffer).toString('utf8')
      : sourceBuffer.toString('utf8')
  )
}

export function hydrateBridgeSeedHit<TNamespace extends string>(
  hit: RetrievedHit<TNamespace>,
  collections: Record<TNamespace, QMDCollectionSpec>,
  bridgeSourceContentCap = 96_000
): RetrievedHit<TNamespace> {
  const namespace = String(hit.namespace)
  if (!canHydrateBridgeSource(namespace)) {
    return hit
  }

  const sourceFilePath = resolveBridgeSourceFilePath(hit.path, collections)
  if (!sourceFilePath || !fs.existsSync(sourceFilePath)) {
    return hit
  }

  try {
    const sourceContent = readBridgeSourceContent(sourceFilePath)
    if (!sourceContent || sourceContent.length <= hit.content.length) {
      return hit
    }

    return {
      ...hit,
      content: clipBridgeSourceContent(sourceContent, bridgeSourceContentCap)
    }
  } catch {
    return hit
  }
}

function buildBridgeCandidateTexts<TNamespace extends string>(
  queryTokens: Set<string>,
  hit: RetrievedHit<TNamespace>
): string[] {
  const titlePrefix = `${hit.title} ${path.basename(hit.path || '')}`.trim()
  const lines = buildSemanticLines(hit)

  if (lines.length === 0) {
    return [buildHitText(hit)]
  }

  const candidateWindows = new Map<string, { text: string, overlapCount: number }>()
  for (const line of lines) {
    const lineTokens = new Set(tokenizeQuery(line))
    let lineOverlapCount = 0
    for (const token of queryTokens) {
      if (lineTokens.has(token)) {
        lineOverlapCount += 1
      }
    }

    if (lineOverlapCount === 0) {
      continue
    }

    const fullText = titlePrefix
      ? `${titlePrefix} ${line}`
      : line
    const focusedText = focusCandidateTextAroundQuery(fullText, queryTokens)
    const key = focusedText.toLowerCase()
    const existing = candidateWindows.get(key)

    if (!existing || lineOverlapCount > existing.overlapCount) {
      candidateWindows.set(key, {
        text: focusedText,
        overlapCount: lineOverlapCount
      })
    }
  }

  if (candidateWindows.size === 0) {
    return [buildHitText(hit)]
  }

  return [...candidateWindows.values()]
    .sort((entryA, entryB) => {
      if (entryB.overlapCount !== entryA.overlapCount) {
        return entryB.overlapCount - entryA.overlapCount
      }

      return entryA.text.length - entryB.text.length
    })
    .map((entry) => entry.text)
    .slice(0, 8)
}

function isInformativeBridgeToken(token: string, queryTokens: Set<string>): boolean {
  if (tokenLength(token) < 4 || queryTokens.has(token)) {
    return false
  }

  return /\p{L}/u.test(token)
}

export function buildBridgeQueryTokens<TNamespace extends string>(
  queryTokens: Set<string>,
  hits: RetrievedHit<TNamespace>[],
  persistentNamespaces: string[] = ['memory_persistent']
): string[] {
  if (queryTokens.size === 0 || hits.length === 0) {
    return []
  }

  const persistentNamespaceSet = new Set(persistentNamespaces)
  const sourceHits = hits
    .filter((hit) => !persistentNamespaceSet.has(String(hit.namespace)))
    .slice(0, 8)
  if (sourceHits.length === 0) {
    return []
  }

  let totalCandidateSegments = 0
  const candidateStats = new Map<
    string,
    { score: number, hitCount: number, segmentCount: number }
  >()

  for (const [hitIndex, hit] of sourceHits.entries()) {
    const candidateTexts = buildBridgeCandidateTexts(queryTokens, hit)
    const rankWeight = 1 / (hitIndex + 1)
    const seenInHit = new Set<string>()

    for (const candidateText of candidateTexts) {
      const candidateTokens = [...new Set(tokenizeQuery(candidateText))]
        .filter((token) => isInformativeBridgeToken(token, queryTokens))
      if (candidateTokens.length === 0) {
        continue
      }

      const segmentOverlapCount = [...queryTokens].filter((token) =>
        new Set(tokenizeQuery(candidateText)).has(token)
      ).length
      if (segmentOverlapCount <= 0) {
        continue
      }

      totalCandidateSegments += 1
      const segmentBaseScore =
        (Math.max(0.1, hit.score) + Math.min(0.35, segmentOverlapCount / 4)) *
        rankWeight

      for (const token of candidateTokens) {
        const stats = candidateStats.get(token) || {
          score: 0,
          hitCount: 0,
          segmentCount: 0
        }

        stats.score += segmentBaseScore + Math.min(0.35, tokenLength(token) / 20)
        stats.segmentCount += 1
        if (!seenInHit.has(token)) {
          stats.hitCount += 1
          seenInHit.add(token)
        }

        candidateStats.set(token, stats)
      }
    }
  }

  const rankedEntries = [...candidateStats.entries()]
    .map(([token, stats]) => {
      const segmentCoverage =
        totalCandidateSegments > 0
          ? stats.segmentCount / totalCandidateSegments
          : 0
      const distinctiveness = 1 - segmentCoverage

      return {
        token,
        score:
          stats.score *
            Math.max(0.15, distinctiveness) +
          Math.min(0.3, Math.max(0, stats.hitCount - 1) * 0.12),
        segmentCoverage
      }
    })
    .filter((entry) => entry.segmentCoverage < 0.8 || totalCandidateSegments < 3)
    .sort((entryA, entryB) => entryB.score - entryA.score)

  return rankedEntries
    .map((entry) => entry.token)
    .slice(0, 8)
}

export function buildHydratedRescueBridgeTokens<TNamespace extends string>(
  queryTokens: Set<string>,
  rankedHitsInput: RankedRetrievedHit<TNamespace>[],
  collections: Record<TNamespace, QMDCollectionSpec>,
  bridgeSourceContentCap = 96_000,
  maxHits = 3
): string[] {
  if (queryTokens.size === 0 || rankedHitsInput.length === 0 || maxHits <= 0) {
    return []
  }

  const primaryHits = rankedHitsInput
    .map((rankedHit) => rankedHit.hit)
    .filter((hit) => String(hit.namespace) !== 'context')
    .slice(0, maxHits)
  const topPersistentHit = rankedHitsInput.find(
    (rankedHit) => String(rankedHit.hit.namespace) === 'memory_persistent'
  )?.hit
  const seedHits = [...primaryHits, topPersistentHit].filter(
    (hit): hit is RetrievedHit<TNamespace> => Boolean(hit)
  )
  const hydratedHits = [...new Map(
    seedHits.map((hit) => [`${hit.namespace}|${hit.path}|${hit.id}`, hit])
  ).values()]
    .map((hit) => hydrateBridgeSeedHit(hit, collections, bridgeSourceContentCap))

  if (hydratedHits.length === 0) {
    return []
  }

  return dedupeStable([
    ...buildBridgeQueryTokens(queryTokens, hydratedHits, []),
    ...buildSupportTokensFromHits(queryTokens, hydratedHits, maxHits * 2)
  ]).slice(0, 8)
}

function buildBacktrackTemporalHits<TNamespace extends string>(
  hit: RetrievedHit<TNamespace>,
  collections: Record<TNamespace, QMDCollectionSpec>,
  bridgeSourceContentCap: number,
  maxPreviousHits: number
): RetrievedHit<TNamespace>[] {
  const namespace = String(hit.namespace)
  if (!canBacktrackTemporalSource(namespace) || maxPreviousHits <= 0) {
    return []
  }

  const collection = collections[hit.namespace]
  if (!collection?.dir || !collection.name) {
    return []
  }

  const sourceFilePath = resolveBridgeSourceFilePath(hit.path, collections)
  if (!sourceFilePath || !fs.existsSync(sourceFilePath)) {
    return []
  }

  const sourceBasename = path.basename(sourceFilePath)
  const collectionDir = path.resolve(collection.dir)

  let filenames: string[] = []
  try {
    filenames = fs.readdirSync(collectionDir)
  } catch {
    return []
  }

  const datedFiles = filenames
    .filter((filename) => /^\d{4}-\d{2}-\d{2}\.md(?:\.gz)?$/i.test(filename))
    .sort()
  const sourceIndex = datedFiles.indexOf(sourceBasename)
  if (sourceIndex <= 0) {
    return []
  }

  return datedFiles
    .slice(Math.max(0, sourceIndex - maxPreviousHits), sourceIndex)
    .reverse()
    .map((filename, index) => {
      const filePath = path.join(collectionDir, filename)
      try {
        const content = clipBridgeSourceContent(
          readBridgeSourceContent(filePath),
          bridgeSourceContentCap
        )
        if (!content) {
          return null
        }

        return {
          id: `${String(hit.namespace)}:${filename}`,
          path: buildQmdSourcePath(
            collection.name,
            path.relative(collectionDir, filePath)
          ),
          title: filename.replace(/\.md(?:\.gz)?$/i, ''),
          content,
          score: Math.max(0.05, hit.score * Math.max(0.45, 0.78 - index * 0.12)),
          namespace: hit.namespace
        }
      } catch {
        return null
      }
    })
    .filter((candidate): candidate is RetrievedHit<TNamespace> => Boolean(candidate))
}

export function buildHydratedBacktrackCandidates<TNamespace extends string>(
  queryTokens: Set<string>,
  rankedHitsInput: RankedRetrievedHit<TNamespace>[],
  collections: Record<TNamespace, QMDCollectionSpec>,
  namespaceWeights: Partial<Record<TNamespace, number>> = {},
  bridgeSourceContentCap = 96_000,
  maxPrimaryHits = 3,
  maxPreviousHits = 2
): Array<{
  hit: RetrievedHit<TNamespace>
  rankingScore: number
  overlapCount: number
}> {
  if (
    queryTokens.size === 0 ||
    rankedHitsInput.length === 0 ||
    maxPrimaryHits <= 0
  ) {
    return []
  }

  const primaryHits = rankedHitsInput
    .map((rankedHit) => rankedHit.hit)
    .filter((hit) => String(hit.namespace) !== 'context')
    .slice(0, maxPrimaryHits)
  const topPersistentHit = rankedHitsInput.find(
    (rankedHit) => String(rankedHit.hit.namespace) === 'memory_persistent'
  )?.hit

  const seedHits = [...new Map(
    [...primaryHits, topPersistentHit]
      .filter((hit): hit is RetrievedHit<TNamespace> => Boolean(hit))
      .map((hit) => [`${hit.namespace}|${hit.path}|${hit.id}`, hit])
  ).values()].map((hit) =>
    hydrateBridgeSeedHit(hit, collections, bridgeSourceContentCap)
  )
  if (seedHits.length === 0) {
    return []
  }

  const candidateHits = [...seedHits]
  for (const hit of seedHits) {
    candidateHits.push(
      ...buildBacktrackTemporalHits(
        hit,
        collections,
        bridgeSourceContentCap,
        maxPreviousHits
      )
    )
  }

  const uniqueCandidateHits = [...new Map(
    candidateHits.map((hit) => [`${hit.namespace}|${hit.path}`, hit])
  ).values()]
  const supportTokens = buildSupportTokensFromHits(
    queryTokens,
    seedHits,
    maxPrimaryHits * 3
  )
  const bridgeTokens = buildBridgeQueryTokens(queryTokens, seedHits, []).slice(0, 8)
  const expandedQueryTokens = new Set<string>([
    ...queryTokens,
    ...supportTokens,
    ...bridgeTokens
  ])

  return rankRetrievedHits(
    uniqueCandidateHits,
    expandedQueryTokens,
    collections,
    namespaceWeights,
    bridgeSourceContentCap
  )
    .filter((entry) => entry.overlapCount > 0)
    .slice(0, Math.max(maxPrimaryHits + maxPreviousHits, 4))
}

export function shouldRunAdaptiveSecondPass<TNamespace extends string>(
  rankedHitsInput: RankedRetrievedHit<TNamespace>[],
  persistentNamespaces: string[] = ['memory_persistent']
): boolean {
  if (rankedHitsInput.length === 0) {
    return true
  }

  const persistentNamespaceSet = new Set(persistentNamespaces)
  const topWindow = rankedHitsInput.slice(0, Math.min(6, rankedHitsInput.length))
  const maxOverlap = topWindow.reduce(
    (maxValue, current) => Math.max(maxValue, current.overlapCount),
    0
  )
  const bestScore = topWindow[0]?.rankingScore || 0
  const nonPersistentCount = topWindow.filter(
    (rankedHit) => !persistentNamespaceSet.has(String(rankedHit.hit.namespace))
  ).length
  const hasStrongNonPersistentMatch = topWindow.some(
    (rankedHit) =>
      !persistentNamespaceSet.has(String(rankedHit.hit.namespace)) &&
      rankedHit.overlapCount >= 2
  )

  if (maxOverlap === 0) {
    return true
  }

  if (bestScore < 1 && maxOverlap <= 1) {
    return true
  }

  if (
    nonPersistentCount <= 1 &&
    !hasStrongNonPersistentMatch &&
    maxOverlap <= 1
  ) {
    return true
  }

  return false
}

export function buildDiscriminativeSecondPass<TNamespace extends string>(
  originalQuery: string,
  queryTokens: Set<string>,
  hitsInput: RetrievedHit<TNamespace>[],
  collections: Record<TNamespace, QMDCollectionSpec>,
  bridgeSourceContentCap = 96_000
): { lexicalQuery: string, bridgeTokens: string[] } | null {
  if (queryTokens.size < 2 || hitsInput.length === 0) {
    return null
  }

  const excerptQueryTokens = buildAdaptiveQueryTokenSet(
    queryTokens,
    hitsInput,
    collections,
    bridgeSourceContentCap
  )
  const bridgeSeedHits = hitsInput.map((hit) =>
    hydrateBridgeSeedHit(hit, collections, bridgeSourceContentCap)
  )
  const bridgeTokens = buildBridgeQueryTokens(excerptQueryTokens, bridgeSeedHits)
  if (bridgeTokens.length === 0) {
    return null
  }

  const rewrittenQuery = buildLexicalSearchQuery(originalQuery, bridgeTokens)
  if (!rewrittenQuery) {
    return null
  }

  return rewrittenQuery.toLowerCase() === buildLexicalSearchQuery(originalQuery).toLowerCase()
    ? null
    : {
        lexicalQuery: rewrittenQuery,
        bridgeTokens: bridgeTokens.slice(0, 8)
      }
}

export function buildFinalSupportTokens<TNamespace extends string>(
  queryTokens: Set<string>,
  rankedHitsInput: RankedRetrievedHit<TNamespace>[],
  collections: Record<TNamespace, QMDCollectionSpec>,
  bridgeSourceContentCap = 96_000,
  extraTokens: string[] = [],
  limit = 8
): string[] {
  return [
    ...new Set([
      ...extraTokens,
      ...buildSupportTokensFromHits(
        queryTokens,
        rankedHitsInput.map((rankedHit) => rankedHit.hit),
        limit
      ),
      ...buildBridgeQueryTokens(
        queryTokens,
        rankedHitsInput.map((rankedHit) =>
          hydrateBridgeSeedHit(
            rankedHit.hit,
            collections,
            bridgeSourceContentCap
          )
        )
      ).slice(0, limit)
    ])
  ].slice(0, limit)
}

export function buildSupportTokensFromHits<TNamespace extends string>(
  queryTokens: Set<string>,
  hits: RetrievedHit<TNamespace>[],
  limit: number
): string[] {
  const tokenStats = new Map<string, { score: number, hitCount: number }>()

  for (const hit of hits.slice(0, Math.max(limit * 2, 8))) {
    const hitTokens = new Set(
      tokenizeQuery(buildHitText(hit, 1_500)).filter((token) =>
        isInformativeBridgeToken(token, queryTokens)
      )
    )

    for (const token of hitTokens) {
      const stats = tokenStats.get(token) || {
        score: 0,
        hitCount: 0
      }
      stats.score += Math.max(0.1, hit.score) + Math.min(0.35, tokenLength(token) / 20)
      stats.hitCount += 1
      tokenStats.set(token, stats)
    }
  }

  return [...tokenStats.entries()]
    .sort((entryA, entryB) => {
      if (entryB[1].hitCount !== entryA[1].hitCount) {
        return entryB[1].hitCount - entryA[1].hitCount
      }

      return entryB[1].score - entryA[1].score
    })
    .map(([token]) => token)
    .slice(0, limit)
}

export function buildFocusedHitContent<TNamespace extends string>(
  hit: RetrievedHit<TNamespace>,
  queryTokens: Set<string>,
  supportTokens: string[],
  collections: Record<TNamespace, QMDCollectionSpec>,
  bridgeSourceContentCap = 96_000
): string {
  const hydratedHit = hydrateBridgeSeedHit(hit, collections, bridgeSourceContentCap)
  const normalizedContent = normalizeContent(hydratedHit.content)
  const namespace = String(hydratedHit.namespace)

  if (!normalizedContent || !canHydrateBridgeSource(namespace)) {
    return normalizeContent(hit.content)
  }

  const lines = buildSemanticLines({
    ...hydratedHit,
    content: normalizedContent
  })
  if (lines.length === 0) {
    return normalizeContent(hit.content)
  }

  if (namespace === 'memory_persistent') {
    return normalizeContent(lines.slice(-2).join('\n'))
  }

  const supportTokenSet = new Set(supportTokens)
  const tokenDocumentFrequency = new Map<string, number>()
  for (const line of lines) {
    const lineTokens = new Set(
      tokenizeQuery(line).filter((token) => isInformativeBridgeToken(token, queryTokens))
    )
    for (const token of lineTokens) {
      tokenDocumentFrequency.set(token, (tokenDocumentFrequency.get(token) || 0) + 1)
    }
  }
  let bestWindowText = ''
  let bestWindowScore = Number.NEGATIVE_INFINITY

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || ''
    const lineTokens = new Set(tokenizeQuery(line))
    const lineOverlapCount = [...queryTokens].filter((token) =>
      lineTokens.has(token)
    ).length
    const lineSupportCount = [...supportTokenSet].filter((token) =>
      lineTokens.has(token)
    ).length
    if (lineOverlapCount === 0 && lineSupportCount === 0) {
      continue
    }

    const windowText = normalizeContent(
      lines.slice(Math.max(0, index - 1), Math.min(lines.length, index + 3)).join('\n')
    )
    if (!windowText) {
      continue
    }

    const windowTokens = new Set(tokenizeQuery(windowText))
    const overlapCount = [...queryTokens].filter((token) =>
      windowTokens.has(token)
    ).length
    const supportCount = [...supportTokenSet].filter((token) =>
      windowTokens.has(token)
    ).length
    const novelTokenCount = [...windowTokens].filter(
      (token) => isInformativeBridgeToken(token, queryTokens)
    ).length
    const rarityBoost = [...windowTokens]
      .filter((token) => isInformativeBridgeToken(token, queryTokens))
      .reduce((score, token) => {
        const documentFrequency = tokenDocumentFrequency.get(token) || 1
        return score + 1 / documentFrequency
      }, 0)
    const score =
      supportCount * 3 +
      overlapCount * 1.15 +
      lineSupportCount * 1.4 +
      lineOverlapCount * 0.35 +
      Math.min(2.2, novelTokenCount * 0.22) +
      Math.min(2.6, rarityBoost * 0.25) -
      Math.max(0, windowText.length - 900) / 4_000 +
      ((index + 1) / lines.length) * 0.35

    if (score > bestWindowScore) {
      bestWindowScore = score
      bestWindowText = windowText
    }
  }

  return bestWindowText || normalizedContent
}
