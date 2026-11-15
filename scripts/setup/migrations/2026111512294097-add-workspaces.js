import fs from 'node:fs'
import path from 'node:path'

const DATABASE_FILENAME = 'conversations.sqlite'

/**
 * Keep project context beside conversation metadata so removal can detach
 * conversations atomically without changing their history or external files.
 */
export function initializeWorkspaces(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS conversation_sessions_workspace
      ON conversation_sessions(json_extract(payload, '$.workspaceId'), pinned DESC, activity_at DESC, id DESC);
  `)
}

export default async function migrate(profilePaths) {
  const filename = path.join(profilePaths.sessions, DATABASE_FILENAME)
  if (!fs.existsSync(filename)) {
    return
  }

  const { default: SQLite } = await import('better-sqlite3')
  const db = new SQLite(filename)
  try {
    db.pragma('busy_timeout = 5000')
    initializeWorkspaces(db)
  } finally {
    db.close()
  }
}
