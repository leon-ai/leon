import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

import SQLite from 'better-sqlite3'
import type { Database } from 'better-sqlite3'

import {
  CONVERSATION_DATABASE_FILENAME,
  initializeConversationArchive,
  summarizeConversationRecord
} from '@@/scripts/setup/migrations/2026103008000293-add-conversation-archive.js'
import { createProfileServiceProxy } from '@/core/profile-runtime/profile-runtime-manager'
import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import type { MessageLog } from '@/types'
import type { AgentProgressMessage } from '@/core/llm-manager/agent-progress-contract'
import { FyiKind, type Fyi } from '@/core/fyi/fyi-contract'
import { FYI_VISIONS } from '@/core/fyi/visions'
import {
  DEFAULT_ARCHIVE_PAGE_CHARACTERS,
  MAXIMUM_ARCHIVE_PAGE_CHARACTERS
} from '@@/bridges/runtime/contracts/conversation-archive'
import type {
  ArchiveMessagePage,
  ArchiveMessageReadOptions,
  ArchiveSessionPage,
  ArchiveSessionReadOptions
} from '@@/bridges/runtime/contracts/conversation-archive'
import { TOOL_CONTENT_PREVIEW_CHARACTERS } from './tool-content-contract'
import type { ToolCallContents, ToolContentPart } from './tool-content-contract'

import type { ConversationSession } from './index'
import { getSessionSearchTerms } from './session-search'
import { normalizeSearchText, prepareSearchQuery, rankSearchFields, SearchRank } from '@/helpers/search-helper'
import type { SearchQuery } from '@/helpers/search-helper'
import { MAXIMUM_SESSION_SEARCH_EXCERPT_CHARACTERS } from './session-search-contract'
import type { SessionSearchMatch } from './session-search-contract'

const DEFAULT_PAGE_SIZE = 40
const MAXIMUM_PAGE_SIZE = 100
const MAXIMUM_REPLAY_EVENTS = 10_000
const MAXIMUM_REPLAY_BYTES = 16 * 1_024 * 1_024
const MAXIMUM_QUERY_HISTORY_CHARACTERS = 128 * 1_024
const SESSION_SEARCH_EXCERPT_TOKENS = 16
const SESSION_SEARCH_EXCERPT_LEADING_CHARACTERS = 24
const FYI_VISION_ROTATION_KEY = 'fyi_vision_rotation'
const UI_MESSAGE_FILTER = `(visible = 1 OR trace_id IS NOT NULL
  OR json_type(summary, '$.agentResponseTrace') = 'object'
  OR json_array_length(summary, '$.artifacts') > 0
  OR json_type(summary, '$.widget') = 'object')`

enum ContentMatchRank {
  Phrase,
  Terms
}

export type ConversationCommandStatus = 'accepted' | 'completed' | 'stopped' | 'error' | 'interrupted'

export interface ConversationCommand {
  id: string
  session_id: string
  query: string
  status: ConversationCommandStatus
  created_at: number
}

export interface ConversationPage<T> {
  items: T[]
  nextCursor: string | null
  previousCursor?: string | null
}

export interface ConversationWriteOptions {
  replaceMessageId?: string | null
  refreshSentAt?: boolean
  sentAt?: number
  sessionId?: string
  activity?: boolean
}

interface SessionCursor {
  pinned: number
  activity: number
  id: string
  rank?: number
  search?: string
  phrase?: ContentMatchRank
  score?: number
  source?: number | null
}

interface SessionPage extends ConversationPage<ConversationSession> {
  searchMatches?: Record<string, SessionSearchMatch>
}

interface ArchiveCursor {
  sessionId: string
  role: ArchiveSessionPage['role']
  sequence: number
  offset: number
  through: number
}

function pageSize(limit = DEFAULT_PAGE_SIZE): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAXIMUM_PAGE_SIZE) {
    throw new Error(`Page size must be between 1 and ${MAXIMUM_PAGE_SIZE}.`)
  }

  return limit
}

function parseSessionCursor(cursor?: string): SessionCursor | null {
  if (!cursor) {
    return null
  }

  const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  if ((value.pinned !== 0 && value.pinned !== 1) ||
    !Number.isSafeInteger(value.activity) || typeof value.id !== 'string') {
    throw new Error('Invalid session cursor.')
  }

  return value as SessionCursor
}

function parseArchiveCursor(
  cursor: string,
  sessionId: string,
  role: ArchiveSessionPage['role']
): ArchiveCursor {
  try {
    const value = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8')
    ) as ArchiveCursor

    if (
      value?.sessionId === sessionId && value.role === role &&
      Number.isSafeInteger(value.sequence) && value.sequence > 0 &&
      Number.isSafeInteger(value.offset) && value.offset >= 0 &&
      Number.isSafeInteger(value.through) && value.through >= value.sequence
    ) {
      return value
    }
  } catch {
    // Invalid continuation data must never silently restart or select another source.
  }

  throw new Error('Invalid archive cursor.')
}

/**
 * Owns indexed, durable conversation data for exactly one profile directory.
 * Legacy JSON is imported once and preserved as a migration backup.
 */
export class ConversationRepository {
  private readonly db: Database

  public constructor(sessionsPath: string) {
    fs.mkdirSync(sessionsPath, { recursive: true })
    this.db = new SQLite(path.join(sessionsPath, CONVERSATION_DATABASE_FILENAME))
    try {
      this.db.function('session_title_rank', { deterministic: true }, (title: string, query: string) =>
        rankSearchFields([normalizeSearchText(title)], JSON.parse(query) as SearchQuery)
      )
      initializeConversationArchive(this.db, sessionsPath)
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  /**
   * Releases the profile-owned SQLite handle.
   */
  public close(): void {
    this.db.close()
  }

  /**
   * Marks orphaned commands only when the profile runtime first takes ownership.
   * Merely opening an archive connection must not interrupt another live owner.
   */
  public recoverInterruptedCommands(): void {
    this.db.prepare(`UPDATE conversation_commands SET status = 'interrupted', updated_at = ?
      WHERE status = 'accepted'`).run(Date.now())
  }

  /**
   * Restores compatibility metadata without reading any message bodies.
   */
  public readIndex(): { activeSessionId: string, sessions: ConversationSession[] } | null {
    const sessions = this.db.prepare('SELECT payload FROM conversation_sessions').all()
      .map((row) => JSON.parse(String(row['payload'])) as ConversationSession)
    const active = this.db.prepare('SELECT value FROM conversation_state WHERE key = ?')
      .get('active_session_id')

    return sessions.length > 0
      ? { activeSessionId: String(active?.['value'] ?? sessions[0]!.id), sessions }
      : null
  }

  /**
   * Persists one changed session rather than rewriting the whole session index.
   */
  public saveSession(session: ConversationSession): void {
    this.db.prepare(`INSERT INTO conversation_sessions(id, title, pinned, activity_at, payload)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, pinned=excluded.pinned,
      activity_at=excluded.activity_at, payload=excluded.payload`)
      .run(session.id, session.title, Number(session.isPinned),
        session.lastMessageAt ?? session.updatedAt, JSON.stringify(session))
  }

  /**
   * Keeps the legacy default selection separate from each client's viewed session.
   */
  public saveActiveSession(sessionId: string): void {
    this.db.prepare(`INSERT INTO conversation_state(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value
      WHERE conversation_state.value != excluded.value`)
      .run('active_session_id', sessionId)
  }

  /**
   * Reads current metadata without touching history or trace payloads.
   */
  public readSession(sessionId: string): ConversationSession | null {
    const row = this.db.prepare('SELECT payload FROM conversation_sessions WHERE id = ?')
      .get(sessionId)

    return row ? JSON.parse(String(row['payload'])) as ConversationSession : null
  }

  /**
   * Checks archive initialization without materializing the legacy metadata index.
   */
  public hasSessions(): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM conversation_sessions LIMIT 1').get())
  }

  /**
   * Removes owned history and its search entries in the same transaction.
   */
  public deleteSession(sessionId: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM conversation_events WHERE session_id = ?').run(sessionId)
      this.db.prepare('DELETE FROM conversation_sessions WHERE id = ?').run(sessionId)
    })()
  }

  /**
   * Reads a bounded, indexed session page; content search never downloads logs.
   */
  public listSessions(options: {
    limit?: number
    cursor?: string
    query?: string
  } = {}): SessionPage {
    const limit = pageSize(options.limit)
    const cursor = parseSessionCursor(options.cursor)
    const query = options.query?.trim() ?? ''
    const prepared = prepareSearchQuery(query)
    if (prepared.compact) {
      return this.db.transaction(() => this.searchSessionPage(query, prepared, limit, cursor))()
    }
    if (cursor?.rank !== undefined || cursor?.search !== undefined ||
      cursor?.phrase !== undefined || cursor?.score !== undefined || cursor?.source !== undefined) {
      throw new Error('The session cursor belongs to another search.')
    }
    const filters: string[] = []
    const values: unknown[] = []

    if (cursor) {
      filters.push('(pinned, activity_at, id) < (?, ?, ?)')
      values.push(cursor.pinned, cursor.activity, cursor.id)
    }

    const rows = this.db.prepare(`SELECT id, pinned, activity_at, payload
      FROM conversation_sessions ${filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : ''}
      ORDER BY pinned DESC, activity_at DESC, id DESC LIMIT ?`).all(...values, limit + 1)
    const selected = rows.slice(0, limit)
    const last = selected.at(-1)

    return {
      items: selected.map((row) => JSON.parse(String(row['payload'])) as ConversationSession),
      nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({
        pinned: last['pinned'], activity: last['activity_at'], id: last['id']
      })).toString('base64url') : null
    }
  }

  /**
   * Ranks title matches before indexed content, then pages by relevance and recency.
   * Only selected content-only hits need excerpts; history and trace payloads stay out.
   */
  private searchSessionPage(
    query: string,
    prepared: SearchQuery,
    limit: number,
    cursor: SessionCursor | null
  ): SessionPage {
    const encodedQuery = JSON.stringify(prepared)
    // FTS operators remain literal input; prefixes preserve partial-word searching.
    const words = getSessionSearchTerms(query, { unique: false })
      .map((term) => `"${term.replaceAll('"', '""')}"*`)
    const match = [...new Set(words)].join(' AND ')
    const phrase = words.join(' + ')
    const search = createHash('sha256').update(encodedQuery).update(match).update(phrase).digest('hex')
    if (cursor && (
      cursor.search !== search || !Number.isInteger(cursor.rank) ||
      cursor.rank! < SearchRank.Exact || cursor.rank! > SearchRank.None ||
      (cursor.phrase !== ContentMatchRank.Phrase && cursor.phrase !== ContentMatchRank.Terms) ||
      typeof cursor.score !== 'number' || !Number.isFinite(cursor.score) ||
      (cursor.rank === SearchRank.None && (!Number.isSafeInteger(cursor.source) || cursor.source! < 1))
    )) {
      throw new Error('Invalid search cursor.')
    }

    // Unrelated new messages change corpus-wide BM25 statistics. Re-score the
    // cursor's passage in the same read snapshot, rather than comparing old scores.
    const anchor = cursor?.rank === SearchRank.None && match ? this.db.prepare(`
      SELECT rank AS score FROM conversation_search
      WHERE rowid = CAST(@rowid AS INTEGER) AND conversation_search MATCH @match LIMIT 1
    `).get({ rowid: cursor.source, match }) : undefined
    const cursorScore = typeof anchor?.['score'] === 'number' ? anchor['score'] : cursor?.score
    const bindings: Record<string, string | number> = {
      query: encodedQuery, noMatch: SearchRank.None, limit: limit + 1,
      phraseMatch: ContentMatchRank.Phrase, termMatch: ContentMatchRank.Terms,
      ...(match ? { match, phrase } : {}),
      ...(cursor ? { rank: cursor.rank!, activity: cursor.activity, id: cursor.id,
        cursorPhrase: cursor.phrase!, score: cursorScore! } : {})
    }
    // Evaluate BM25 while the FTS cursor is active, before grouping/windowing.
    // Keep one best passage per session, preferring adjacent words before score.
    const rows = this.db.prepare(`WITH title_ranks AS MATERIALIZED (
        SELECT id, session_title_rank(title, @query) AS search_rank
        FROM conversation_sessions
      ), phrase_matches AS MATERIALIZED (
        ${match ? `SELECT rowid AS message_rowid FROM conversation_search
          WHERE conversation_search MATCH @phrase`
          : 'SELECT NULL AS message_rowid WHERE 0'}
      ), content_scores AS MATERIALIZED (
        ${match ? `SELECT session_id, rowid AS message_rowid, rank AS score
          FROM conversation_search WHERE conversation_search MATCH @match`
          : 'SELECT NULL AS session_id, NULL AS message_rowid, 0 AS score WHERE 0'}
      ), ordered_content AS (
        SELECT c.*, CASE WHEN p.message_rowid IS NULL THEN @termMatch ELSE @phraseMatch END AS phrase_rank,
          row_number() OVER (PARTITION BY c.session_id
            ORDER BY (p.message_rowid IS NULL), c.score, c.message_rowid DESC) AS choice
        FROM content_scores c LEFT JOIN phrase_matches p ON p.message_rowid = c.message_rowid
      ), content_matches AS (
        SELECT session_id, message_rowid, score, phrase_rank FROM ordered_content WHERE choice = 1
      ), ranked_sessions AS (
        SELECT s.id, s.pinned, s.activity_at, t.search_rank, c.message_rowid,
          CASE WHEN t.search_rank = @noMatch THEN c.phrase_rank ELSE @phraseMatch END AS phrase_rank,
          CASE WHEN t.search_rank = @noMatch THEN c.score ELSE 0 END AS content_score
        FROM conversation_sessions s
        JOIN title_ranks t ON t.id = s.id
        LEFT JOIN content_matches c ON c.session_id = s.id
        WHERE (t.search_rank < @noMatch OR c.message_rowid IS NOT NULL)
      )
      SELECT r.*, s.payload FROM ranked_sessions r JOIN conversation_sessions s ON s.id = r.id
      ${cursor ? `WHERE ((r.search_rank, r.phrase_rank, r.content_score) > (@rank, @cursorPhrase, @score)
        OR ((r.search_rank, r.phrase_rank, r.content_score) = (@rank, @cursorPhrase, @score)
          AND (r.activity_at, r.id) < (@activity, @id)))` : ''}
      ORDER BY r.search_rank, r.phrase_rank, r.content_score, r.activity_at DESC, r.id DESC
      LIMIT @limit`).all(bindings)
    const selected = rows.slice(0, limit)
    const last = selected.at(-1)
    // Native match positions keep excerpts focused even beside giant tokens. The
    // per-request markers are stripped in SQLite; only bounded plain text leaves it.
    // Limit materialization to one source row instead of exhausting FTS candidates.
    // FTS point lookups need integer rowids; JavaScript numbers bind as REAL.
    const marker = randomUUID()
    const excerptQuery = match ? this.db.prepare(`WITH fragment AS MATERIALIZED (
        SELECT snippet(conversation_search, 0, @opening, @closing, '…', @tokens) AS marked
        FROM conversation_search WHERE rowid = CAST(@rowid AS INTEGER)
          AND conversation_search MATCH @match LIMIT 1
      ), focused AS (
        SELECT replace(replace(marked, @opening, ''), @closing, '') AS text,
          max(1, instr(marked, @opening) - @leading) AS offset FROM fragment
      ) SELECT CASE WHEN offset > 1 THEN '…' ELSE '' END ||
        substr(text, offset, @characters - (offset > 1)) AS excerpt FROM focused`) : null
    const searchMatches = Object.fromEntries(selected.flatMap((row) => {
      if (row['search_rank'] !== SearchRank.None || !excerptQuery) {
        return []
      }
      const result = excerptQuery.get({
        opening: `[${marker}]`, closing: `[/${marker}]`,
        tokens: SESSION_SEARCH_EXCERPT_TOKENS,
        leading: SESSION_SEARCH_EXCERPT_LEADING_CHARACTERS,
        characters: MAXIMUM_SESSION_SEARCH_EXCERPT_CHARACTERS,
        rowid: row['message_rowid'],
        match: row['phrase_rank'] === ContentMatchRank.Phrase ? phrase : match
      })

      return result ? [[String(row['id']), { excerpt: String(result['excerpt']) }]] : []
    }))

    return {
      items: selected.map((row) => JSON.parse(String(row['payload'])) as ConversationSession),
      searchMatches,
      nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({
        pinned: last['pinned'], activity: last['activity_at'], id: last['id'],
        rank: last['search_rank'], phrase: last['phrase_rank'], score: last['content_score'],
        source: last['message_rowid'], search
      })).toString('base64url') : null
    }
  }

  /**
   * Upserts one message, preserving trace identity and rejecting late draft saves.
   */
  public upsertMessage(
    sessionId: string,
    record: Omit<MessageLog, 'sentAt'>,
    options: ConversationWriteOptions = {}
  ): void {
    this.db.transaction(() => {
      const id = options.replaceMessageId || record.messageId ||
        record.agentResponseTrace?.id || randomUUID()
      const previous = this.db.prepare(`SELECT id, payload FROM conversation_messages
        WHERE session_id = ? AND (id = ? OR trace_id = ?) LIMIT 1`)
        .get(sessionId, id, record.agentResponseTrace?.id ?? null)
      const existing = previous ? JSON.parse(String(previous['payload'])) as MessageLog : null

      if (options.activity && existing?.isAddedToHistory) {
        return
      }

      const session = this.readSession(sessionId)
      if (!session) {
        throw new Error('The conversation session no longer exists.')
      }

      const value: MessageLog = {
        ...existing,
        ...record,
        messageId: record.messageId || (previous ? String(previous['id']) : id),
        sentAt: options.sentAt ?? (
          !existing || options.refreshSentAt ||
          (!existing.isAddedToHistory && record.isAddedToHistory)
            ? Date.now()
            : existing.sentAt
        )
      }

      if (existing && existing.message !== value.message && !record.fyi) {
        delete value.fyi
      }

      if (previous && previous['id'] !== value.messageId) {
        this.db.prepare('UPDATE conversation_messages SET id = ? WHERE session_id = ? AND id = ?')
          .run(value.messageId, sessionId, previous['id'])
      }

      this.db.prepare(`INSERT INTO conversation_messages
        (session_id, id, trace_id, sent_at, visible, role, content, payload, summary)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(session_id, id) DO UPDATE SET
        trace_id=excluded.trace_id, sent_at=excluded.sent_at, visible=excluded.visible,
        role=excluded.role, content=excluded.content, payload=excluded.payload, summary=excluded.summary`)
        .run(sessionId, value.messageId, value.agentResponseTrace?.id ?? null,
          value.sentAt, Number(value.isAddedToHistory), value.who, value.message,
          JSON.stringify(value), JSON.stringify(summarizeConversationRecord(value)))

      if (!value.isAddedToHistory && !existing?.isAddedToHistory) {
        return
      }

      const delta = Number(value.isAddedToHistory) - Number(existing?.isAddedToHistory ?? false)
      const lastMessageAt = value.isAddedToHistory
        ? Math.max(session.lastMessageAt ?? 0, value.sentAt)
        : existing?.isAddedToHistory
          ? this.getMessageStats(sessionId).lastMessageAt
          : session.lastMessageAt
      const updatedAt = Date.now()

      // Commit the sidebar projection with the message so a restart never sees
      // new history paired with stale counts or last-message attribution.
      this.db.prepare(`UPDATE conversation_sessions SET
        activity_at = ?, payload = json_set(payload,
          '$.messageCount', coalesce(json_extract(payload, '$.messageCount'), 0) + ?,
          '$.lastMessageAt', ?, '$.updatedAt', ?)
        WHERE id = ?`)
        .run(lastMessageAt ?? updatedAt, delta, lastMessageAt, updatedAt, sessionId)
    })()
  }

  /**
   * Loads older records by immutable sequence, independently of display timestamps.
   */
  public readMessages(sessionId: string, options: {
    limit?: number
    before?: string
    after?: string
    summary?: boolean
  } = {}): ConversationPage<MessageLog> {
    const limit = pageSize(options.limit)
    const before = options.before === undefined ? null : Number(options.before)
    const after = options.after === undefined ? null : Number(options.after)
    if ((before !== null && (!Number.isSafeInteger(before) || before < 1)) ||
      (after !== null && (!Number.isSafeInteger(after) || after < 1)) ||
      before !== null && after !== null) {
      throw new Error('Invalid conversation cursor.')
    }

    const rows = this.db.prepare(`SELECT sequence, ${options.summary ? 'summary' : 'payload'} AS value
      FROM conversation_messages WHERE session_id = ? AND ${UI_MESSAGE_FILTER}
        ${before === null ? '' : 'AND sequence < ?'}
        ${after === null ? '' : 'AND sequence > ?'}
      ORDER BY sequence ${after === null ? 'DESC' : 'ASC'} LIMIT ?`)
      .all(sessionId, ...(before === null ? [] : [before]), ...(after === null ? [] : [after]), limit + 1)
    const selected = rows.slice(0, limit)
    const ordered = after === null ? selected.reverse() : selected
    const first = ordered[0]
    const last = ordered.at(-1)
    const hasOlder = first && this.db.prepare(`SELECT 1 FROM conversation_messages
      WHERE session_id = ? AND ${UI_MESSAGE_FILTER} AND sequence < ? LIMIT 1`).get(sessionId, first['sequence'])
    const hasNewer = last && this.db.prepare(`SELECT 1 FROM conversation_messages
      WHERE session_id = ? AND ${UI_MESSAGE_FILTER} AND sequence > ? LIMIT 1`).get(sessionId, last['sequence'])

    return {
      items: ordered.map((row) => JSON.parse(String(row['value'])) as MessageLog),
      nextCursor: hasOlder ? String(first!['sequence']) : null,
      previousCursor: hasNewer ? String(last!['sequence']) : null
    }
  }

  /**
   * Supports existing archive consumers without imposing the model context limit
   * on the owner's retained history.
   */
  public readAllMessages(sessionId: string): MessageLog[] {
    return this.db.prepare(`SELECT payload FROM conversation_messages
      WHERE session_id = ? ORDER BY sequence`).all(sessionId)
      .map((row) => JSON.parse(String(row['payload'])) as MessageLog)
  }

  /**
   * Pages submitted queries without loading answers or trace payloads. Character
   * budgets keep large prompts bounded without returning partial query text.
   */
  public readQueryHistory(sessionId: string, options: {
    limit?: number
    before?: string
    characters?: number
  } = {}): ConversationPage<{ messageId: string, message: string }> {
    const limit = pageSize(options.limit)
    const before = options.before === undefined ? null : Number(options.before)
    const requestedCharacters = options.characters ?? MAXIMUM_QUERY_HISTORY_CHARACTERS

    if (before !== null && (!Number.isSafeInteger(before) || before < 1)) {
      throw new Error('Invalid conversation cursor.')
    }
    if (!Number.isSafeInteger(requestedCharacters) || requestedCharacters < 1) {
      throw new Error('Invalid query history character budget.')
    }

    const maximumCharacters = Math.min(requestedCharacters, MAXIMUM_QUERY_HISTORY_CHARACTERS)
    const rows = this.db.prepare(`SELECT sequence, id, content FROM conversation_messages
      WHERE session_id = ? AND role = 'owner' AND visible = 1 AND content != ''
        ${before === null ? '' : 'AND sequence < ?'}
      ORDER BY sequence DESC LIMIT ?`)
      .iterate(sessionId, ...(before === null ? [] : [before]), limit + 1)
    const items: { messageId: string, message: string }[] = []
    let characters = 0
    let lastSequence: string | null = null
    let nextCursor: string | null = null

    for (const row of rows) {
      const message = String(row['content'])
      if (items.length === limit || characters + message.length > maximumCharacters) {
        nextCursor = lastSequence
        break
      }

      items.push({ messageId: String(row['id']), message })
      characters += message.length
      lastSequence = String(row['sequence'])
    }

    return { items, nextCursor }
  }

  /**
   * Supplies the bounded model-context window without reading the full archive.
   */
  public readRecentMessages(sessionId: string, limit: number, sortBySentAt = false): MessageLog[] {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error('The conversation context limit must be a positive integer.')
    }

    return this.db.prepare(`SELECT payload FROM conversation_messages
      WHERE session_id = ? ORDER BY ${sortBySentAt ? 'sent_at DESC,' : ''} sequence DESC LIMIT ?`).all(sessionId, limit)
      .map((row) => JSON.parse(String(row['payload'])) as MessageLog).reverse()
  }

  /**
   * Reads model text without parsing reasoning, artifacts, or tool disclosure bodies.
   */
  public readContextMessages(sessionId: string, limit: number): MessageLog[] {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error('The conversation context limit must be a positive integer.')
    }

    return this.db.prepare(`SELECT id, role, content, sent_at, visible FROM conversation_messages
      WHERE session_id = ? ORDER BY sequence DESC LIMIT ?`).all(sessionId, limit)
      .map((row) => ({
        messageId: String(row['id']), who: row['role'] as MessageLog['who'],
        message: String(row['content']), sentAt: Number(row['sent_at']), isAddedToHistory: row['visible'] === 1
      })).reverse()
  }

  /**
   * Reads one disclosure body without loading the rest of the conversation.
   */
  public readMessage(sessionId: string, messageId: string): MessageLog | null {
    const row = this.db.prepare(`SELECT payload FROM conversation_messages
      WHERE session_id = ? AND (id = ? OR trace_id = ?) LIMIT 1`)
      .get(sessionId, messageId, messageId)

    return row ? JSON.parse(String(row['payload'])) as MessageLog : null
  }

  /**
   * Adds completed memory outcomes without rewriting an answer, its clock, or
   * the session's activity ordering. Deleted turns must never be recreated.
   */
  public upsertMemoryActivity(sessionId: string, messageId: string, activity: AgentProgressMessage): boolean {
    return this.db.transaction(() => {
      const record = this.readMessage(sessionId, messageId)
      if (!record?.isAddedToHistory || record.who !== 'leon' || !activity.memory) {
        return false
      }
      const trace = record.agentResponseTrace ?? {
        id: record.messageId ?? messageId, planSteps: [], toolCalls: []
      }
      const messages = new Map((trace.progressMessages ?? []).map((message) => [message.id, message]))
      messages.set(activity.id, activity)
      const value = { ...record, agentResponseTrace: { ...trace, progressMessages: [...messages.values()] } }
      this.db.prepare(`UPDATE conversation_messages SET payload = ?, summary = ?
        WHERE session_id = ? AND (id = ? OR trace_id = ?)`)
        .run(JSON.stringify(value), JSON.stringify(summarizeConversationRecord(value)), sessionId, messageId, messageId)
      return true
    })()
  }

  /**
   * Commits a footer once against its unchanged accepted answer. Vision selection
   * and profile-wide rotation advance atomically, including across connections.
   */
  public saveFyi(sessionId: string, messageId: string, answer: string, candidate: Fyi | null): Fyi | null {
    return this.db.transaction(() => {
      const record = this.db.prepare(`SELECT id FROM conversation_messages
        WHERE session_id = ? AND (id = ? OR trace_id = ?) AND role = 'leon'
          AND visible = 1 AND content = ? AND json_type(payload, '$.fyi') IS NULL`)
        .get(sessionId, messageId, messageId, answer)
      if (!record) {
        return null
      }

      let fyi = candidate
      if (!fyi) {
        const row = this.db.prepare('SELECT value FROM conversation_state WHERE key = ?').get(FYI_VISION_ROTATION_KEY)
        const state = row ? JSON.parse(String(row['value'])) as { remaining: string[], lastId: string } : null
        let remaining = state?.remaining.filter((id) => FYI_VISIONS.some((vision) => vision.id === id)) ?? []
        if (!remaining.length) {
          remaining = FYI_VISIONS.map((vision) => vision.id)
        }
        // Avoid an immediate repeat at the boundary between complete rotations.
        const choices = remaining.filter((id) => id !== state?.lastId)
        const id = choices[Math.floor(Math.random() * choices.length)]!
        const vision = FYI_VISIONS.find((item) => item.id === id)!
        this.db.prepare(`INSERT INTO conversation_state(key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
          .run(FYI_VISION_ROTATION_KEY, JSON.stringify({ remaining: remaining.filter((item) => item !== id), lastId: id }))
        fyi = { kind: FyiKind.Vision, text: vision.text }
      }

      const json = JSON.stringify(fyi)
      this.db.prepare(`UPDATE conversation_messages SET payload = json_set(payload, '$.fyi', json(?)),
        summary = json_set(summary, '$.fyi', json(?)) WHERE session_id = ? AND id = ?`)
        .run(json, json, sessionId, record['id'])
      return fyi
    }).immediate()
  }

  /**
   * Pages visible source text in SQLite so a long archived document never requires
   * transferring its full body or unrelated inference and tool disclosures.
   */
  public readMessageText(
    sessionId: string,
    messageId: string,
    options: ArchiveMessageReadOptions = {}
  ): ArchiveMessagePage | null {
    const offset = options.offset ?? 0
    const requestedLimit = options.limit ?? DEFAULT_ARCHIVE_PAGE_CHARACTERS
    if (!Number.isSafeInteger(offset) || offset < 0 ||
      !Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
      throw new Error('Archive offsets must be non-negative integers and limits must be positive integers.')
    }

    const limit = Math.min(requestedLimit, MAXIMUM_ARCHIVE_PAGE_CHARACTERS)
    // SQLite offsets count Unicode characters; continuation must use these units too.
    const row = this.db.prepare(`SELECT id, role, sent_at,
        substr(content, ?, ?) AS text, length(content) AS total_characters
      FROM conversation_messages
      WHERE session_id = ? AND id = ? AND visible = 1 AND role IN ('owner', 'leon')
      LIMIT 1`).get(offset + 1, limit, sessionId, messageId)
    if (!row) {
      return null
    }

    const totalCharacters = Number(row['total_characters'])
    if (offset > totalCharacters) {
      throw new Error('The archive offset is beyond the end of this message.')
    }

    return {
      sessionId,
      messageId: String(row['id']),
      who: row['role'] as ArchiveMessagePage['who'],
      sentAt: Number(row['sent_at']),
      text: String(row['text']),
      offset,
      nextOffset: offset + limit < totalCharacters ? offset + limit : null,
      totalCharacters
    }
  }

  /**
   * Reads a selected conversation in source order, including documents supplied
   * across messages, without transferring private traces or its entire history.
   */
  public readSessionText(
    sessionId: string,
    options: ArchiveSessionReadOptions = {}
  ): ArchiveSessionPage | null {
    const requested = options.limit ?? DEFAULT_ARCHIVE_PAGE_CHARACTERS
    const role = options.role ?? 'owner'

    if (!Number.isSafeInteger(requested) || requested < 1) {
      throw new Error('Archive page limits must be positive integers.')
    }
    if (role !== 'owner' && role !== 'leon' && role !== 'both') {
      throw new Error('Invalid archive role.')
    }

    const cursor = options.cursor
      ? parseArchiveCursor(options.cursor, sessionId, role) : null
    if (!this.db.prepare('SELECT 1 FROM conversation_sessions WHERE id = ?').get(sessionId)) {
      return null
    }

    // Pin the source boundary so new messages cannot extend a read indefinitely.
    const through = cursor?.through ?? Number(this.db.prepare(`SELECT max(sequence) AS sequence
      FROM conversation_messages WHERE session_id = ? AND visible = 1
        AND (? = 'both' OR role = ?) AND role IN ('owner', 'leon') AND content != ''`)
      .get(sessionId, role, role)?.['sequence'] ?? 0)
    const rows = this.db.prepare(`SELECT id, sequence FROM conversation_messages
      WHERE session_id = ? AND visible = 1 AND role IN ('owner', 'leon')
        AND (? = 'both' OR role = ?) AND content != '' AND sequence >= ? AND sequence <= ?
      ORDER BY sequence LIMIT ?`)
      .all(sessionId, role, role, cursor?.sequence ?? 0, through, MAXIMUM_PAGE_SIZE + 1)
    const messages: ArchiveMessagePage[] = []
    let remaining = Math.min(requested, MAXIMUM_ARCHIVE_PAGE_CHARACTERS)
    let next: ArchiveCursor | null = null

    for (const [index, row] of rows.entries()) {
      const sequence = Number(row['sequence'])
      const offset = sequence === cursor?.sequence ? cursor.offset : 0
      if (remaining === 0 || index === MAXIMUM_PAGE_SIZE) {
        next = { sessionId, role, sequence, offset, through }
        break
      }
      const page = this.readMessageText(sessionId, String(row['id']), {
        offset, limit: remaining
      })
      if (!page) {
        continue
      }
      messages.push(page)
      remaining -= Array.from(page.text).length

      if (page.nextOffset !== null) {
        next = { sessionId, role, sequence, offset: page.nextOffset, through }
        break
      }
    }

    return {
      sessionId,
      role,
      nextCursor: next ? Buffer.from(JSON.stringify(next)).toString('base64url') : null,
      messages
    }
  }

  /**
   * Reads one invocation without materializing or transferring the other calls.
   * SQLite bounds previews before large bodies enter the JavaScript heap.
   */
  public readToolContents(sessionId: string, messageId: string, toolId: string, complete = false): ToolCallContents | null {
    const row = this.db.prepare(`WITH invocation AS (
      SELECT call.value AS body FROM conversation_messages AS message,
        json_each(message.payload, '$.agentResponseTrace.toolCalls') AS call
      WHERE message.session_id = @sessionId AND (message.id = @messageId OR message.trace_id = @messageId)
        AND json_extract(call.value, '$.id') = @toolId LIMIT 1
    ), results AS (
      SELECT body, CASE
        WHEN json_type(body, '$.output.result.data') = 'object' THEN json_extract(body, '$.output.result.data')
        WHEN json_type(body, '$.output.result') = 'object' THEN json_extract(body, '$.output.result')
        WHEN json_type(body, '$.output.data') = 'object' THEN json_extract(body, '$.output.data')
        WHEN json_type(body, '$.output') = 'object' THEN json_extract(body, '$.output')
        ELSE '{}' END AS result
      FROM invocation
    ), formatted_results AS (
      SELECT body, result, CASE WHEN json_extract(result, '$.format') = 'markdown'
        OR (json_type(result, '$.sources') = 'array' AND json_type(result, '$.content') = 'text')
        THEN 'markdown' ELSE 'text' END AS document_format FROM results
    ), contents AS (
      SELECT
        CASE WHEN json_type(body, '$.input') = 'text' THEN
          CASE WHEN json_valid(json_extract(body, '$.input')) THEN json_pretty(json_extract(body, '$.input'), '  ')
            ELSE json_extract(body, '$.input') END
          WHEN json_type(body, '$.input') = 'true' THEN 'true'
          WHEN json_type(body, '$.input') = 'false' THEN 'false'
          ELSE coalesce(json_pretty(json_extract(body, '$.input'), '  '), 'null') END AS input,
        CASE WHEN json_type(body, '$.output') = 'text' THEN json_extract(body, '$.output')
          WHEN json_type(body, '$.output') = 'true' THEN 'true'
          WHEN json_type(body, '$.output') = 'false' THEN 'false'
          WHEN json_type(body, '$.output') IS NOT NULL THEN coalesce(json_pretty(json_extract(body, '$.output'), '  '), 'null')
          ELSE coalesce(json_extract(body, '$.commandOutput'), json_extract(body, '$.errorMessage'), '') END AS output,
        json_extract(body, '$.commandOutput') AS command_output,
        (json_extract(result, '$.changed') = 1 AND json_type(result, '$.diff') = 'text') AS has_changes,
        coalesce(json_extract(result, '$.diffTruncated'), 0) AS diff_truncated,
        CASE WHEN json_type(result, '$.path') = 'text' AND json_type(result, '$.content') = 'text'
          AND json_type(result, '$.contentHash') = 'text' THEN json_extract(result, '$.content')
          WHEN document_format = 'markdown' THEN CASE
            WHEN json_type(result, '$.content') = 'text' AND length(trim(json_extract(result, '$.content'))) > 0
              THEN json_extract(result, '$.content')
            WHEN json_type(result, '$.text') = 'text' AND length(trim(json_extract(result, '$.text'))) > 0
              THEN json_extract(result, '$.text') END
          END AS display_content,
        CASE WHEN json_type(result, '$.contentHash') = 'text'
          THEN json_extract(result, '$.path') END AS source_path,
        document_format,
        CASE WHEN json_type(body, '$.input') = 'text' AND NOT json_valid(json_extract(body, '$.input'))
          THEN 'text' ELSE 'json' END AS input_language,
        CASE WHEN json_type(body, '$.output') IS NOT NULL AND json_type(body, '$.output') != 'text'
          THEN 'json' ELSE 'text' END AS output_language
      FROM formatted_results
    ) SELECT CASE WHEN @complete THEN input ELSE substr(input, 1, @limit) END AS input,
      length(input) AS input_length, input_language,
      has_changes, diff_truncated,
      CASE WHEN @complete THEN output ELSE substr(output, 1, @limit) END AS output,
      length(output) AS output_length, output_language,
      CASE WHEN @complete THEN command_output
        WHEN document_format = 'markdown' THEN substr(command_output, 1, @limit)
        ELSE substr(command_output, -@limit) END AS command_output,
      length(command_output) AS command_length, document_format,
      CASE WHEN @complete THEN display_content ELSE substr(display_content, 1, @limit) END AS display_content,
      length(display_content) AS display_length, source_path
      FROM contents`).get({ sessionId, messageId, toolId,
      limit: TOOL_CONTENT_PREVIEW_CHARACTERS, complete: Number(complete) })

    if (!row) {
      return null
    }

    const part = (key: string, lengthKey: string, language: ToolContentPart['language']): ToolContentPart => {
      const totalCharacters = Number(row[lengthKey] ?? 0)

      return { text: String(row[key] ?? ''), totalCharacters,
        truncated: !complete && totalCharacters > TOOL_CONTENT_PREVIEW_CHARACTERS, language }
    }

    return {
      hasChanges: row['has_changes'] === 1,
      diffTruncated: row['diff_truncated'] === 1,
      input: part('input', 'input_length', row['input_language'] as ToolContentPart['language']),
      output: part('output', 'output_length', row['output_language'] as ToolContentPart['language']),
      ...(row['command_output'] === null ? {} : {
        commandOutput: part('command_output', 'command_length', row['document_format'] as string)
      }),
      ...(row['display_content'] === null ? {} : {
        displayOutput: part('display_content', 'display_length', row['source_path']
          ? path.extname(String(row['source_path'])).slice(1).toLocaleLowerCase() || 'text' : 'markdown')
      })
    }
  }

  /**
   * Computes sidebar counts from indexed metadata, not serialized history bodies.
   */
  public getMessageStats(sessionId: string): { count: number, lastMessageAt: number | null } {
    const count = this.db.prepare(`SELECT count(*) AS total FROM conversation_messages
      WHERE session_id = ? AND visible = 1`).get(sessionId)
    const last = this.db.prepare(`SELECT max(sent_at) AS sent_at FROM conversation_messages
      WHERE session_id = ? AND visible = 1`).get(sessionId)

    return { count: Number(count?.['total'] ?? 0), lastMessageAt: Number(last?.['sent_at']) || null }
  }

  /**
   * Clears only the specified conversation.
   */
  public clearMessages(sessionId: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM conversation_messages WHERE session_id = ?').run(sessionId)
      this.db.prepare(`UPDATE conversation_sessions SET activity_at = ?,
        payload = json_set(payload, '$.messageCount', 0, '$.lastMessageAt', NULL, '$.updatedAt', ?)
        WHERE id = ?`).run(Date.now(), Date.now(), sessionId)
    })()
  }

  /**
   * Assigns durable profile-local event cursors, surviving server restarts.
   */
  public appendEvent<T extends { sequence: number, session_id: string }>(
    event: Omit<T, 'sequence'>
  ): T {
    return this.db.transaction(() => {
      const result = this.db.prepare(`INSERT INTO conversation_events(session_id, payload)
        VALUES (?, ?)`).run(event.session_id, JSON.stringify(event))
      const sequence = Number(result.lastInsertRowid)
      this.db.prepare('DELETE FROM conversation_events WHERE sequence <= ?')
        .run(sequence - MAXIMUM_REPLAY_EVENTS)
      // Count alone does not bound retained tool-output payloads.
      const retained = this.db.prepare('SELECT value FROM conversation_state WHERE key = \'replay_bytes\'').get()
      if (Number(retained?.['value']) > MAXIMUM_REPLAY_BYTES) {
        this.db.prepare(`DELETE FROM conversation_events WHERE sequence IN (
          SELECT sequence FROM (
            SELECT sequence, sum(length(CAST(payload AS BLOB))) OVER (ORDER BY sequence DESC) AS bytes
            FROM conversation_events
          ) WHERE bytes > ?
        )`).run(MAXIMUM_REPLAY_BYTES * .75)
      }

      return { ...event, sequence } as T
    })()
  }

  /**
   * Replays a bounded tail; clients with an expired cursor must reload a snapshot.
   * Session-scoped streams also receive profile-wide state with an empty session ID.
   */
  public readEvents<T extends { sequence: number }>(
    afterSequence = 0,
    sessionId?: string,
    limit = DEFAULT_PAGE_SIZE,
    throughSequence?: number
  ): ConversationPage<T> {
    const rows = this.db.prepare(`SELECT sequence, payload FROM conversation_events
      WHERE sequence > ? ${sessionId ? 'AND (session_id = ? OR session_id = \'\')' : ''}
        ${throughSequence === undefined ? '' : 'AND sequence <= ?'}
      ORDER BY sequence LIMIT ?`)
      .all(afterSequence, ...(sessionId ? [sessionId] : []),
        ...(throughSequence === undefined ? [] : [throughSequence]), pageSize(limit) + 1)
    const selected = rows.slice(0, limit)

    return {
      items: selected.map((row) => ({
        ...JSON.parse(String(row['payload'])), sequence: Number(row['sequence'])
      }) as T),
      nextCursor: rows.length > limit ? String(selected.at(-1)!['sequence']) : null
    }
  }

  /**
   * Identifies cursors that require a fresh authoritative snapshot.
   */
  public getReplayBounds(): { oldest: number, latest: number } {
    const oldest = this.db.prepare('SELECT sequence FROM conversation_events ORDER BY sequence LIMIT 1').get()
    const latest = this.db.prepare('SELECT seq AS sequence FROM sqlite_sequence WHERE name = \'conversation_events\'').get()

    const frontier = Number(latest?.['sequence'] ?? 0)

    return { oldest: Number(oldest?.['sequence'] ?? (frontier > 0 ? frontier + 1 : 0)), latest: frontier }
  }

  /**
   * Atomically accepts a stable command and its owner message before acknowledging.
   * Reusing an ID for different input is rejected rather than executing twice.
   */
  public acceptCommand(sessionId: string, id: string, query: string): { command: ConversationCommand, created: boolean } {
    return this.db.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM conversation_commands WHERE id = ?').get(id)
      if (existing) {
        if (existing['session_id'] !== sessionId || existing['query'] !== query) {
          throw new Error('This message ID was already used for different input.')
        }

        return { command: existing as unknown as ConversationCommand, created: false }
      }

      const createdAt = Date.now()
      this.db.prepare(`INSERT INTO conversation_commands(id, session_id, query, status, created_at, updated_at)
        VALUES (?, ?, ?, 'accepted', ?, ?)`).run(id, sessionId, query, createdAt, createdAt)
      this.upsertMessage(sessionId, {
        who: 'owner', message: query, messageId: id, isAddedToHistory: true
      }, { sentAt: createdAt })

      return {
        command: { id, session_id: sessionId, query, status: 'accepted' as const, created_at: createdAt },
        created: true
      }
    })()
  }

  /**
   * Records terminal command state without retaining an in-memory command cache.
   */
  public finishCommand(id: string, status: ConversationCommandStatus): void {
    this.db.prepare('UPDATE conversation_commands SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, Date.now(), id)
  }

  /**
   * Exposes interruption after restart without resuming side-effecting work.
   */
  public getLatestCommand(sessionId: string): ConversationCommand | null {
    return this.db.prepare(`SELECT * FROM conversation_commands WHERE session_id = ?
      ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(sessionId) as unknown as ConversationCommand | undefined ?? null
  }

  /**
   * Captures a history page and its live-event frontier in one read transaction.
   */
  public readSnapshot(sessionId: string, options: { limit?: number, before?: string, after?: string } = {}): {
    messages: ConversationPage<MessageLog>
    eventCursor: number
    command: ConversationCommand | null
  } {
    return this.db.transaction(() => ({
      messages: this.readMessages(sessionId, { ...options, summary: true }),
      eventCursor: this.getReplayBounds().latest,
      command: this.getLatestCommand(sessionId)
    }))()
  }
}

export const CONVERSATION_REPOSITORY = createProfileServiceProxy(
  'conversation-repository',
  () => {
    const repository = new ConversationRepository(getProfilePaths().sessions)
    repository.recoverInterruptedCommands()

    return repository
  }
)
