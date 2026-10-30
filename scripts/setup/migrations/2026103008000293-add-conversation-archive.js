import fs from 'node:fs'
import path from 'node:path'

export const CONVERSATION_DATABASE_FILENAME = 'conversations.sqlite'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversation_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversation_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  pinned INTEGER NOT NULL,
  activity_at INTEGER NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS conversation_sessions_order
  ON conversation_sessions(pinned DESC, activity_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS conversation_messages (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  trace_id TEXT,
  sent_at INTEGER NOT NULL,
  visible INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  payload TEXT NOT NULL,
  summary TEXT NOT NULL,
  UNIQUE(session_id, id)
);
CREATE INDEX IF NOT EXISTS conversation_messages_page
  ON conversation_messages(session_id, sequence DESC);
CREATE INDEX IF NOT EXISTS conversation_messages_trace
  ON conversation_messages(session_id, trace_id);
CREATE INDEX IF NOT EXISTS conversation_messages_visible
  ON conversation_messages(session_id, visible, sequence DESC);
CREATE INDEX IF NOT EXISTS conversation_messages_display
  ON conversation_messages(session_id, sent_at DESC, sequence DESC);
CREATE VIRTUAL TABLE IF NOT EXISTS conversation_search USING fts5(
  content, session_id UNINDEXED, content='conversation_messages', content_rowid='sequence'
);
CREATE TRIGGER IF NOT EXISTS conversation_search_insert AFTER INSERT ON conversation_messages BEGIN
  INSERT INTO conversation_search(rowid, content, session_id)
    VALUES (new.sequence, CASE WHEN new.visible THEN new.content ELSE '' END, new.session_id);
END;
CREATE TRIGGER IF NOT EXISTS conversation_search_delete AFTER DELETE ON conversation_messages BEGIN
  INSERT INTO conversation_search(conversation_search, rowid, content, session_id)
    VALUES ('delete', old.sequence, CASE WHEN old.visible THEN old.content ELSE '' END, old.session_id);
END;
CREATE TRIGGER IF NOT EXISTS conversation_search_update AFTER UPDATE ON conversation_messages
WHEN old.content != new.content OR old.visible != new.visible BEGIN
  INSERT INTO conversation_search(conversation_search, rowid, content, session_id)
    VALUES ('delete', old.sequence, CASE WHEN old.visible THEN old.content ELSE '' END, old.session_id);
  INSERT INTO conversation_search(rowid, content, session_id)
    VALUES (new.sequence, CASE WHEN new.visible THEN new.content ELSE '' END, new.session_id);
END;
CREATE TABLE IF NOT EXISTS conversation_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS conversation_events_session
  ON conversation_events(session_id, sequence);
INSERT OR IGNORE INTO conversation_state(key, value)
  SELECT 'replay_bytes', CAST(coalesce(sum(length(CAST(payload AS BLOB))), 0) AS TEXT) FROM conversation_events;
CREATE TRIGGER IF NOT EXISTS conversation_events_insert AFTER INSERT ON conversation_events BEGIN
  UPDATE conversation_state SET value = CAST(value AS INTEGER) + length(CAST(new.payload AS BLOB))
    WHERE key = 'replay_bytes';
END;
CREATE TRIGGER IF NOT EXISTS conversation_events_delete AFTER DELETE ON conversation_events BEGIN
  UPDATE conversation_state SET value = CAST(value AS INTEGER) - length(CAST(old.payload AS BLOB))
    WHERE key = 'replay_bytes';
END;
CREATE TABLE IF NOT EXISTS conversation_commands (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS conversation_commands_session
  ON conversation_commands(session_id, created_at DESC);
`

/**
 * Excludes heavy disclosure bodies from the initial history page; full records
 * remain available in the archive when the owner opens a disclosure.
 */
export function summarizeConversationRecord(record) {
  const trace = record.agentResponseTrace
  if (!trace) {
    return record
  }

  return {
    ...record,
    agentResponseTrace: {
      ...trace,
      ...(trace.reasoning ? {
        reasoning: trace.reasoning.map((block) => ({ ...block, text: '' }))
      } : {}),
      toolCalls: (trace.toolCalls || []).map((call) => {
        const summary = { ...call }
        delete summary.input
        delete summary.output
        delete summary.commandOutput
        return summary
      })
    }
  }
}

/**
 * Imports legacy sessions atomically without rewriting or removing their files.
 * A database marker, not file age, makes interrupted and repeated setup safe.
 */
export function initializeConversationArchive(db, sessionsPath) {
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
  db.exec(SCHEMA)
  if (!db.prepare('PRAGMA table_info(conversation_messages)').all().some((column) => column.name === 'role')) {
    db.transaction(() => {
      db.exec(`ALTER TABLE conversation_messages ADD COLUMN role TEXT NOT NULL DEFAULT '';
        UPDATE conversation_messages SET role = json_extract(payload, '$.who');`)
    })()
  }
  db.exec(`CREATE INDEX IF NOT EXISTS conversation_messages_role
    ON conversation_messages(session_id, role, sequence DESC);`)
  db.exec('BEGIN IMMEDIATE')
  try {
    if (db.prepare('SELECT value FROM conversation_state WHERE key = ?').get('legacy_imported')) {
      db.exec('COMMIT')
      return
    }

    const indexPath = path.join(sessionsPath, 'index.json')
    if (fs.existsSync(indexPath)) {
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
      if (!Array.isArray(index.sessions)) {
        throw new Error('The conversation session index is invalid.')
      }

      const insertSession = db.prepare(`INSERT INTO conversation_sessions
        (id, title, pinned, activity_at, payload) VALUES (?, ?, ?, ?, ?)`)
      const insertMessage = db.prepare(`INSERT INTO conversation_messages
        (session_id, id, trace_id, sent_at, visible, role, content, payload, summary)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)

      for (const session of index.sessions) {
        if (typeof session.id !== 'string' || !session.id ||
          session.id === '.' || session.id === '..' ||
          path.posix.basename(session.id) !== session.id ||
          path.win32.basename(session.id) !== session.id) {
          throw new Error('The conversation archive contains an invalid session ID.')
        }

        insertSession.run(session.id, session.title || '', Number(session.isPinned === true),
          session.lastMessageAt ?? session.updatedAt ?? session.createdAt ?? 0, JSON.stringify(session))
        const logPath = path.join(sessionsPath, session.id, 'conversation_log.json')
        if (!fs.existsSync(logPath)) {
          continue
        }

        const records = JSON.parse(fs.readFileSync(logPath, 'utf8'))
        if (!Array.isArray(records)) {
          throw new Error(`The conversation log for "${session.id}" is invalid.`)
        }

        for (const [position, original] of records.entries()) {
          const id = original.messageId || original.agentResponseTrace?.id ||
            `${session.id}:legacy:${position}`
          const record = { ...original, messageId: id }
          insertMessage.run(session.id, id, original.agentResponseTrace?.id ?? null,
            record.sentAt, Number(record.isAddedToHistory === true), record.who, record.message,
            JSON.stringify(record), JSON.stringify(summarizeConversationRecord(record)))
        }

        const visible = records.filter((record) => record.isAddedToHistory === true)
        const lastMessageAt = visible.length > 0
          ? Math.max(...visible.map((record) => record.sentAt))
          : null
        db.prepare('UPDATE conversation_sessions SET activity_at = ?, payload = ? WHERE id = ?')
          .run(lastMessageAt ?? session.updatedAt ?? session.createdAt ?? 0,
            JSON.stringify({ ...session, messageCount: visible.length, lastMessageAt }), session.id)
      }

      if (index.activeSessionId) {
        db.prepare('INSERT INTO conversation_state(key, value) VALUES (?, ?)')
          .run('active_session_id', index.activeSessionId)
      }
    }

    db.prepare('INSERT INTO conversation_state(key, value) VALUES (?, ?)')
      .run('legacy_imported', '1')
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/**
 * Keeps every profile's conversation archive under its existing sessions path.
 */
export default async function migrate(profilePaths) {
  if (!fs.existsSync(profilePaths.sessions)) {
    return
  }

  const { default: SQLite } = await import('better-sqlite3')
  const db = new SQLite(path.join(profilePaths.sessions, CONVERSATION_DATABASE_FILENAME))
  try {
    initializeConversationArchive(db, profilePaths.sessions)
  } finally {
    db.close()
  }
}
