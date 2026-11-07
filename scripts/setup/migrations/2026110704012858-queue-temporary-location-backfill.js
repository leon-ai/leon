import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Queue legacy owner evidence for runtime normalization without model requests
 * during setup or changes to the original facts and their validity.
 */
export default async function migrate(profilePaths) {
  const dbPath = path.join(profilePaths.memory, 'index.sqlite')
  try {
    await fs.access(dbPath)
  } catch (error) {
    if (error.code === 'ENOENT') {
      return
    }
    throw error
  }

  const { default: SQLite } = await import('better-sqlite3')
  const db = new SQLite(dbPath, { fileMustExist: true })
  try {
    if (!db.prepare('SELECT 1 FROM sqlite_master WHERE type = \'table\' AND name = \'memory_items\'').get()) {
      return
    }

    db.transaction(() => {
      // Completed receipts remain until their source record is purged, making
      // interrupted setup safe even if runtime maintenance has already finished.
      db.exec(`CREATE TABLE IF NOT EXISTS temporary_location_backfill (
        item_id TEXT PRIMARY KEY REFERENCES memory_items(id) ON DELETE CASCADE,
        expected_updated_at INTEGER NOT NULL,
        retry_after INTEGER NOT NULL DEFAULT 0,
        completed_at INTEGER
      )`)
      db.prepare(`INSERT OR IGNORE INTO temporary_location_backfill (item_id, expected_updated_at)
        SELECT id, updated_at FROM memory_items
        WHERE scope = 'temporary' AND is_deleted = 0 AND expires_at > ?
          AND source_type IN ('explicit_user', 'inferred') AND source_ref IS NOT NULL
          AND CASE WHEN json_valid(metadata_json) THEN
            json_type(metadata_json, '$.evidence') = 'text'
            AND length(trim(json_extract(metadata_json, '$.evidence'))) > 0
            AND coalesce(json_type(metadata_json, '$.currentLocation'), 'null') = 'null'
          ELSE 0 END
          AND NOT EXISTS (
            SELECT 1 FROM memory_items AS replacement
            WHERE replacement.supersedes_item_id = memory_items.id
              AND replacement.id != memory_items.id
          )`).run(Date.now())
    }).immediate()
  } finally {
    db.close()
  }
}
