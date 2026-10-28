import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Upgrade the scope constraint on first open as well as during setup. Rebuilding
 * the parent with foreign keys disabled preserves its chunks and fact sources.
 */
export function upgradeMemoryScope(db, schemaSQL) {
  const definition = db.prepare('SELECT sql FROM sqlite_master WHERE type = \'table\' AND name = \'memory_items\'').get()
  if (!definition || definition.sql.includes('\'temporary\'')) {
    return
  }

  db.pragma('foreign_keys = OFF')
  try {
    db.transaction(() => {
      // Recheck under the write lock: another worker may have upgraded first.
      const current = db.prepare('SELECT sql FROM sqlite_master WHERE type = \'table\' AND name = \'memory_items\'').get()
      if (current.sql.includes('\'temporary\'')) {
        return
      }

      const start = schemaSQL.indexOf('CREATE TABLE IF NOT EXISTS memory_items (')
      const end = schemaSQL.indexOf('\n);', start)
      if (start < 0 || end < start) {
        throw new Error('Memory schema is missing its item table definition.')
      }
      const createTable = schemaSQL.slice(start, end + 3)
        .replace('CREATE TABLE IF NOT EXISTS memory_items', 'CREATE TABLE memory_items_updated')

      db.exec('DROP VIEW IF EXISTS active_memory_facts; DROP VIEW IF EXISTS active_memory_items;')
      db.exec(createTable)
      db.exec('INSERT INTO memory_items_updated SELECT * FROM memory_items; DROP TABLE memory_items; ALTER TABLE memory_items_updated RENAME TO memory_items;')
      // Connection pragmas cannot be changed inside the atomic rebuild.
      db.exec(schemaSQL.slice(start))
      if (db.pragma('foreign_key_check').length > 0) {
        throw new Error('Memory upgrade failed foreign key validation.')
      }
    }).immediate()
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

/**
 * Preserve existing profile memory while enabling temporary records.
 */
export default async function migrate(profilePaths) {
  const dbPath = path.join(profilePaths.memory, 'index.sqlite')
  try {
    await fs.access(dbPath)
  } catch {
    return
  }

  const { default: SQLite } = await import('better-sqlite3')
  const schemaSQL = await fs.readFile(new URL('../../../server/src/core/memory-manager/sql/schema.sql', import.meta.url), 'utf8')
  const db = new SQLite(dbPath)
  try {
    upgradeMemoryScope(db, schemaSQL)
  } finally {
    db.close()
  }
}
