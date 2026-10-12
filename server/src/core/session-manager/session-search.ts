import fs from 'node:fs'
import path from 'node:path'

const SESSION_INDEX_FILENAME = 'index.json'
const CONVERSATION_LOG_FILENAME = 'conversation_log.json'
const DEFAULT_TOP_K = 5
const MAX_TOP_K = 10
const DEFAULT_CONTEXT_WINDOW = 2
const MAX_CONTEXT_WINDOW = 6
const MAX_EXCERPT_CHARS = 1_000
const WORD_SEGMENTER = new Intl.Segmenter(undefined, {
  granularity: 'word'
})

export type SessionSearchRole = 'owner' | 'leon' | 'both'

interface SessionIndexEntry {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

interface SessionIndexFile {
  activeSessionId: string
  sessions: SessionIndexEntry[]
}

interface SearchableMessage {
  who: 'owner' | 'leon'
  sentAt: number
  message: string
  messageId?: string
}

interface SessionDocument {
  session: SessionIndexEntry
  messages: SearchableMessage[]
}

interface SearchCandidate {
  session: SessionIndexEntry
  messages: SearchableMessage[]
  position: number
  score: number
  matchedTerms: string[]
  matchIndex: number
}

export interface SessionSearchOptions {
  sessionsPath: string
  query: string
  role?: SessionSearchRole
  topK?: number
  contextWindow?: number
  includeCurrentSession?: boolean
  currentSessionId?: string
}

export interface SessionSearchMessage {
  position: number
  messageId?: string
  who: 'owner' | 'leon'
  sentAt: number
  message: string
  excerptStart: number
  isTruncated: boolean
}

export interface SessionSearchHit {
  sessionId: string
  title: string
  createdAt: number
  updatedAt: number
  score: number
  matchedTerms: string[]
  match: SessionSearchMessage
  context: SessionSearchMessage[]
}

export interface SessionSearchResult {
  query: string
  role: SessionSearchRole
  topK: number
  contextWindow: number
  searchedSessions: number
  searchedMessages: number
  hits: SessionSearchHit[]
}

function clampInteger(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number
): number {
  const parsedValue = Number(value)

  return Number.isFinite(parsedValue)
    ? Math.min(maximum, Math.max(minimum, Math.floor(parsedValue)))
    : fallback
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase()
}

function tokenize(value: string): string[] {
  const tokens = new Set<string>()

  for (const segment of WORD_SEGMENTER.segment(normalizeText(value))) {
    if (segment.isWordLike) {
      tokens.add(segment.segment)
    }
  }

  return [...tokens]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseSessionIndex(value: unknown): SessionIndexFile | null {
  if (!isRecord(value) || !Array.isArray(value['sessions'])) {
    return null
  }

  const sessions = value['sessions'].flatMap((item) => {
    if (!isRecord(item) || typeof item['id'] !== 'string') {
      return []
    }

    return [
      {
        id: item['id'],
        title: typeof item['title'] === 'string' ? item['title'] : '',
        createdAt:
          typeof item['createdAt'] === 'number' ? item['createdAt'] : 0,
        updatedAt:
          typeof item['updatedAt'] === 'number' ? item['updatedAt'] : 0
      }
    ]
  })

  return {
    activeSessionId:
      typeof value['activeSessionId'] === 'string'
        ? value['activeSessionId']
        : '',
    sessions
  }
}

function parseConversationLog(value: unknown): SearchableMessage[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    if (
      !isRecord(item) ||
      (item['who'] !== 'owner' && item['who'] !== 'leon') ||
      typeof item['message'] !== 'string' ||
      !item['message'].trim() ||
      item['isAddedToHistory'] !== true
    ) {
      return []
    }

    return [
      {
        who: item['who'],
        sentAt: typeof item['sentAt'] === 'number' ? item['sentAt'] : 0,
        message: item['message'],
        ...(typeof item['messageId'] === 'string'
          ? { messageId: item['messageId'] }
          : {})
      }
    ]
  })
}

function isSafeSessionId(sessionId: string): boolean {
  const normalizedSessionId = sessionId.trim()

  return Boolean(
    normalizedSessionId &&
      normalizedSessionId !== '.' &&
      normalizedSessionId !== '..' &&
      path.posix.basename(normalizedSessionId) === normalizedSessionId &&
      path.win32.basename(normalizedSessionId) === normalizedSessionId
  )
}

async function readJSONFile(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, 'utf8')) as unknown
  } catch {
    return null
  }
}

async function readSessionDocuments(
  sessionsPath: string,
  includeCurrentSession: boolean,
  currentSessionId?: string
): Promise<SessionDocument[]> {
  const index = parseSessionIndex(
    await readJSONFile(path.join(sessionsPath, SESSION_INDEX_FILENAME))
  )
  if (!index) {
    return []
  }

  const excludedSessionId = currentSessionId || index.activeSessionId
  const documents = await Promise.all(
    index.sessions.map(async (session): Promise<SessionDocument | null> => {
      if (
        !isSafeSessionId(session.id) ||
        (!includeCurrentSession && session.id === excludedSessionId)
      ) {
        return null
      }

      const messages = parseConversationLog(
        await readJSONFile(
          path.join(
            sessionsPath,
            session.id,
            CONVERSATION_LOG_FILENAME
          )
        )
      )

      return messages.length > 0 ? { session, messages } : null
    })
  )

  return documents.filter(
    (document): document is SessionDocument => document !== null
  )
}

function findMatchIndex(
  normalizedMessage: string,
  normalizedQuery: string,
  matchedTerms: string[]
): number {
  const exactIndex = normalizedMessage.indexOf(normalizedQuery)
  if (exactIndex >= 0) {
    return exactIndex
  }

  return matchedTerms.reduce((earliestIndex, term) => {
    const index = normalizedMessage.indexOf(term)

    return index >= 0 && (earliestIndex < 0 || index < earliestIndex)
      ? index
      : earliestIndex
  }, -1)
}

function buildSearchMessage(
  message: SearchableMessage,
  position: number,
  focusIndex = 0
): SessionSearchMessage {
  const isTruncated = message.message.length > MAX_EXCERPT_CHARS
  const maximumStart = Math.max(0, message.message.length - MAX_EXCERPT_CHARS)
  const excerptStart = isTruncated
    ? Math.floor(
        Math.min(maximumStart, Math.max(0, focusIndex - MAX_EXCERPT_CHARS / 3))
      )
    : 0

  return {
    position,
    ...(message.messageId ? { messageId: message.messageId } : {}),
    who: message.who,
    sentAt: message.sentAt,
    message: message.message.slice(
      excerptStart,
      excerptStart + MAX_EXCERPT_CHARS
    ),
    excerptStart,
    isTruncated
  }
}

function buildHit(
  candidate: SearchCandidate,
  contextWindow: number
): SessionSearchHit {
  const contextStart = Math.max(0, candidate.position - contextWindow)
  const contextEnd = Math.min(
    candidate.messages.length,
    candidate.position + contextWindow + 1
  )

  return {
    sessionId: candidate.session.id,
    title: candidate.session.title,
    createdAt: candidate.session.createdAt,
    updatedAt: candidate.session.updatedAt,
    score: Number(candidate.score.toFixed(4)),
    matchedTerms: candidate.matchedTerms,
    match: buildSearchMessage(
      candidate.messages[candidate.position]!,
      candidate.position,
      candidate.matchIndex
    ),
    context: candidate.messages
      .slice(contextStart, contextEnd)
      .map((message, offset) => {
        const position = contextStart + offset
        const focusIndex =
          position === candidate.position ? candidate.matchIndex : 0

        return buildSearchMessage(message, position, focusIndex)
      })
  }
}

/**
 * Search the profile's raw, user-visible conversation archive without building
 * a second index. Results are deduplicated by session and include nearby turns.
 */
export async function searchConversationSessions(
  options: SessionSearchOptions
): Promise<SessionSearchResult> {
  const query = String(options.query || '').trim()
  const role: SessionSearchRole =
    options.role === 'owner' || options.role === 'leon'
      ? options.role
      : 'both'
  const topK = clampInteger(options.topK, 1, MAX_TOP_K, DEFAULT_TOP_K)
  const contextWindow = clampInteger(
    options.contextWindow,
    0,
    MAX_CONTEXT_WINDOW,
    DEFAULT_CONTEXT_WINDOW
  )

  if (!query) {
    return {
      query: '',
      role,
      topK,
      contextWindow,
      searchedSessions: 0,
      searchedMessages: 0,
      hits: []
    }
  }

  const documents = await readSessionDocuments(
    options.sessionsPath,
    options.includeCurrentSession === true,
    options.currentSessionId
  )
  const queryTerms = tokenize(query)
  const normalizedQuery = normalizeText(query)
  const searchableMessages = documents.flatMap((document) =>
    document.messages
      .map((message, position) => ({ document, message, position }))
      .filter(({ message }) => role === 'both' || message.who === role)
  )
  const documentFrequency = new Map<string, number>()

  for (const { document, message } of searchableMessages) {
    const targetTerms = new Set(
      tokenize(`${document.session.title}\n${message.message}`)
    )

    for (const term of queryTerms) {
      if (targetTerms.has(term)) {
        documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1)
      }
    }
  }

  const termWeights = new Map(
    queryTerms.map((term) => [
      term,
      Math.log(
        (searchableMessages.length + 1) /
          ((documentFrequency.get(term) || 0) + 1)
      ) + 1
    ])
  )
  const totalTermWeight = [...termWeights.values()].reduce(
    (total, weight) => total + weight,
    0
  )
  const bestCandidateBySession = new Map<string, SearchCandidate>()

  for (const { document, message, position } of searchableMessages) {
    const normalizedMessage = normalizeText(message.message)
    const normalizedTitle = normalizeText(document.session.title)
    const messageTerms = new Set(tokenize(message.message))
    const titleTerms = new Set(tokenize(document.session.title))
    const matchedMessageTerms = queryTerms.filter((term) =>
      messageTerms.has(term)
    )
    const matchedTitleTerms = queryTerms.filter(
      (term) => !messageTerms.has(term) && titleTerms.has(term)
    )
    const matchedTerms = [...matchedMessageTerms, ...matchedTitleTerms]
    const exactMessageMatch = normalizedMessage.includes(normalizedQuery)
    const exactTitleMatch = normalizedTitle.includes(normalizedQuery)

    if (
      !exactMessageMatch &&
      !exactTitleMatch &&
      matchedTerms.length === 0
    ) {
      continue
    }

    const messageWeight = matchedMessageTerms.reduce(
      (total, term) => total + (termWeights.get(term) || 0),
      0
    )
    const titleWeight = matchedTitleTerms.reduce(
      (total, term) => total + (termWeights.get(term) || 0),
      0
    )
    const weightedCoverage =
      totalTermWeight > 0
        ? (messageWeight + titleWeight * 0.35) / totalTermWeight
        : 0
    const score =
      weightedCoverage * 4 +
      (exactMessageMatch ? 3 : 0) +
      (exactTitleMatch ? 0.5 : 0)
    const candidate: SearchCandidate = {
      session: document.session,
      messages: document.messages,
      position,
      score,
      matchedTerms,
      matchIndex: findMatchIndex(
        normalizedMessage,
        normalizedQuery,
        matchedMessageTerms
      )
    }
    const currentBest = bestCandidateBySession.get(document.session.id)

    if (
      !currentBest ||
      candidate.score > currentBest.score ||
      (candidate.score === currentBest.score &&
        message.sentAt > currentBest.messages[currentBest.position]!.sentAt)
    ) {
      bestCandidateBySession.set(document.session.id, candidate)
    }
  }

  const hits = [...bestCandidateBySession.values()]
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      return (
        right.messages[right.position]!.sentAt -
        left.messages[left.position]!.sentAt
      )
    })
    .slice(0, topK)
    .map((candidate) => buildHit(candidate, contextWindow))

  return {
    query,
    role,
    topK,
    contextWindow,
    searchedSessions: documents.length,
    searchedMessages: documents.reduce(
      (total, document) => total + document.messages.length,
      0
    ),
    hits
  }
}
