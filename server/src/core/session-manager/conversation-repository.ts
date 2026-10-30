import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

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

import type { ConversationSession } from './index'
import { getSessionSearchTerms } from './session-search'

const DEFAULT_PAGE_SIZE = 40
const MAXIMUM_PAGE_SIZE = 100
const MAXIMUM_REPLAY_EVENTS = 10_000
const MAXIMUM_REPLAY_BYTES = 16 * 1_024 * 1_024
const UI_MESSAGE_FILTER = `(visible = 1 OR trace_id IS NOT NULL
  OR json_type(summary, '$.agentResponseTrace') = 'object'
  OR json_array_length(summary, '$.artifacts') > 0
  OR json_type(summary, '$.widget') = 'object')`

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
  } = {}): ConversationPage<ConversationSession> {
    const limit = pageSize(options.limit)
    const cursor = parseSessionCursor(options.cursor)
    const query = options.query?.normalize('NFKC').trim() ?? ''
    const filters: string[] = []
    const values: unknown[] = []

    if (cursor) {
      filters.push('(pinned, activity_at, id) < (?, ?, ?)')
      values.push(cursor.pinned, cursor.activity, cursor.id)
    }

    if (query) {
      const terms = getSessionSearchTerms(query)
      const match = terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(' AND ')
      filters.push(terms.length > 0
        ? `(instr(lower(title), lower(?)) > 0 OR id IN (
            SELECT session_id FROM conversation_search WHERE conversation_search MATCH ?
          ))`
        : 'instr(lower(title), lower(?)) > 0')
      // Quoting treats FTS operators as text rather than accepting query syntax.
      values.push(query, ...(match ? [match] : []))
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
