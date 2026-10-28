import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

import SQLite from 'better-sqlite3'
import { upgradeMemoryScope } from '@@/scripts/setup/migrations/2026102907370753-add-temporary-memory-scope.js'
import type {
  Database as SQLiteDatabase,
  Statement
} from 'better-sqlite3'

import { CODEBASE_PATH } from '@/constants'
import { LogHelper } from '@/helpers/log-helper'

import type {
  MemoryRecord,
  MemoryScope,
  MemoryWriteInput,
  RecallResult
} from './types'

const fileName = fileURLToPath(import.meta.url)
const dirName = path.dirname(fileName)

function resolveMemorySchemaPath(): string {
  const candidates = [
    path.join(dirName, 'sql', 'schema.sql'),
    path.join(
      CODEBASE_PATH,
      'server',
      'src',
      'core',
      'memory-manager',
      'sql',
      'schema.sql'
    )
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  return candidates[0] as string
}

function parseJSONValue(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') {
    return {}
  }

  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Ignore malformed JSON and fallback to {}
  }

  return {}
}

function mapMemoryRow(row: Record<string, unknown>): MemoryRecord {
  return {
    id: String(row['id'] || ''),
    scope: String(row['scope'] || 'discussion') as MemoryScope,
    kind: String(row['kind'] || 'note') as MemoryRecord['kind'],
    title: row['title'] ? String(row['title']) : null,
    content: String(row['content_md'] || ''),
    sourceType: String(row['source_type']) as MemoryRecord['sourceType'],
    sourceRef: row['source_ref'] ? String(row['source_ref']) : null,
    importance: Number(row['importance'] ?? 0.5),
    confidence: Number(row['confidence'] ?? 0.7),
    dayKey: row['day_key'] ? String(row['day_key']) : null,
    createdAt: Number(row['created_at'] || Date.now()),
    updatedAt: Number(row['updated_at'] || Date.now()),
    expiresAt:
      typeof row['expires_at'] === 'number'
        ? (row['expires_at'] as number)
        : row['expires_at'] != null
          ? Number(row['expires_at'])
          : null,
    isPinned: Number(row['is_pinned'] || 0) === 1,
    metadata: parseJSONValue(row['metadata_json'])
  }
}

export default class MemoryRepository {
  private db: SQLiteDatabase | null = null
  private loading: Promise<void> | null = null
  private temporaryQuery: Statement | null = null

  public get isReady(): boolean {
    return this.db !== null
  }

  public async load(dbPath: string): Promise<void> {
    if (this.db) {
      return
    }

    if (!this.loading) {
      this.loading = (async (): Promise<void> => {
        await fs.promises.mkdir(path.dirname(dbPath), { recursive: true })
        const schemaSQL = await fs.promises.readFile(resolveMemorySchemaPath(), 'utf8')
        const db = new SQLite(dbPath)
        try {
          upgradeMemoryScope(db, schemaSQL)
          db.exec(schemaSQL)
          this.db = db
        } catch (error) {
          db.close()
          throw error
        }
      })()
    }
    try {
      await this.loading
    } finally {
      this.loading = null
    }
  }

  /**
   * Read bounded current circumstances directly, without search or access-time writes.
   */
  public listTemporaryItems(limit: number): MemoryRecord[] {
    // Prefer the ordered partial index over the generic deleted-status index;
    // otherwise SQLite can sort every active memory before applying the limit.
    this.temporaryQuery ??= this.ensureDb().prepare(
      `SELECT * FROM memory_items INDEXED BY idx_memory_items_temporary
       WHERE scope = 'temporary' AND is_deleted = 0 AND expires_at > ?
         AND NOT EXISTS (
           SELECT 1 FROM memory_items AS replacement
           WHERE replacement.supersedes_item_id = memory_items.id
             AND replacement.id != memory_items.id
         )
       ORDER BY importance DESC, updated_at DESC, id LIMIT ?`
    )
    return this.temporaryQuery.all(Date.now(), limit).map(mapMemoryRow)
  }

  private ensureDb(): SQLiteDatabase {
    if (!this.db) {
      throw new Error('Memory repository is not initialized')
    }

    return this.db
  }

  public upsertMemoryItem(
    input: MemoryWriteInput,
    dedupeHash: string,
    nowTs: number,
    idFactory: () => string
  ): MemoryRecord {
    const db = this.ensureDb()

    return db.transaction(() =>
      this.writeMemoryItem(input, dedupeHash, nowTs, idFactory)
    )()
  }

  private writeMemoryItem(
    input: MemoryWriteInput,
    dedupeHash: string,
    nowTs: number,
    idFactory: () => string
  ): MemoryRecord {
    const db = this.ensureDb()

    if (input.supersedesItemId) {
      const previous = this.getActiveMemoryItem(input.supersedesItemId)
      if (!previous || previous.scope !== input.scope) {
        throw new Error('The memory to correct must be active and in the same scope.')
      }
    }

    // Retired content must release its dedupe key without reviving old evidence.
    db.prepare(
      `UPDATE memory_items SET is_deleted = 1, updated_at = ?
       WHERE scope = ? AND dedupe_hash = ? AND is_deleted = 0
         AND NOT EXISTS (
           SELECT 1 FROM active_memory_items AS current_item
           WHERE current_item.id = memory_items.id
         )`
    ).run(nowTs, input.scope, dedupeHash)

    const findStmt = db.prepare(
      `SELECT * FROM memory_items
       WHERE scope = ? AND dedupe_hash = ? AND is_deleted = 0
       LIMIT 1`
    )
    const existing = findStmt.get(input.scope, dedupeHash)

    if (existing) {
      if (input.scope === 'temporary' && existing['source_ref'] === input.sourceRef && !input.supersedesItemId) {
        return mapMemoryRow(existing)
      }
      // An inferred duplicate must not downgrade direct owner evidence.
      if (
        existing['source_type'] === 'explicit_user' &&
        input.sourceType === 'inferred' &&
        !input.supersedesItemId
      ) {
        return mapMemoryRow(existing)
      }

      const updateStmt = db.prepare(
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
      )

      updateStmt.run(
        input.title || null,
        input.content,
        input.content,
        input.sourceType,
        input.sourceRef || null,
        input.importance ?? 0.5,
        input.confidence ?? 0.7,
        input.dayKey || null,
        nowTs,
        input.expiresAt ?? null,
        input.isPinned ? 1 : 0,
        input.supersedesItemId !== existing['id']
          ? input.supersedesItemId || null
          : null,
        JSON.stringify(input.metadata || {}),
        existing['id']
      )

      const reloaded = db.prepare('SELECT * FROM memory_items WHERE id = ?').get(
        existing['id']
      )
      return mapMemoryRow(reloaded || existing)
    }

    const id = idFactory()
    const insertStmt = db.prepare(
      `INSERT INTO memory_items (
        id, scope, kind, title, content_md, content_text,
        source_type, source_ref, importance, confidence, day_key,
        created_at, updated_at, expires_at, is_pinned,
        supersedes_item_id, dedupe_hash, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    insertStmt.run(
      id,
      input.scope,
      input.kind,
      input.title || null,
      input.content,
      input.content,
      input.sourceType,
      input.sourceRef || null,
      input.importance ?? 0.5,
      input.confidence ?? 0.7,
      input.dayKey || null,
      nowTs,
      nowTs,
      input.expiresAt ?? null,
      input.isPinned ? 1 : 0,
      input.supersedesItemId || null,
      dedupeHash,
      JSON.stringify(input.metadata || {})
    )

    const row = db.prepare('SELECT * FROM memory_items WHERE id = ?').get(id)
    return mapMemoryRow(
      row || {
        id,
        scope: input.scope,
        kind: input.kind,
        title: input.title || null,
        content_md: input.content,
        importance: input.importance ?? 0.5,
        confidence: input.confidence ?? 0.7,
        day_key: input.dayKey || null,
        created_at: nowTs,
        updated_at: nowTs,
        expires_at: input.expiresAt ?? null,
        is_pinned: input.isPinned ? 1 : 0,
        metadata_json: JSON.stringify(input.metadata || {})
      }
    )
  }

  /**
   * Resolve a stable record ID, including retired records needed for mirror cleanup.
   */
  public getMemoryItem(id: string): MemoryRecord | null {
    const row = this.ensureDb()
      .prepare('SELECT * FROM memory_items WHERE id = ?')
      .get(id)
    return row ? mapMemoryRow(row) : null
  }

  /**
   * Validate indexed candidates against the authoritative memory lifecycle.
   */
  public getActiveMemoryItem(id: string): MemoryRecord | null {
    const row = this.ensureDb()
      .prepare('SELECT * FROM active_memory_items WHERE id = ?')
      .get(id)
    return row ? mapMemoryRow(row) : null
  }

  /**
   * Resolve a persistent file or an aggregate day file to its current records.
   */
  public getMirrorRecords(scope: MemoryScope, key: string): MemoryRecord[] {
    const rows = scope === 'persistent'
      ? this.ensureDb()
          .prepare('SELECT * FROM active_memory_items WHERE scope = ? AND id = ?')
          .all(scope, key)
      : this.ensureDb().prepare(
          `SELECT * FROM active_memory_items
           WHERE scope = ? AND day_key = ? ${scope === 'daily' ? 'AND kind = \'summary\'' : ''}
           ORDER BY updated_at DESC ${scope === 'daily' ? 'LIMIT 1' : ''}`
        ).all(scope, key)

    return rows.map(mapMemoryRow)
  }

  /**
   * Find the records affected by a literal-content forget request before cleanup.
   */
  public findMemoryItems(query: string): MemoryRecord[] {
    if (!query.trim()) {
      return []
    }

    return this.ensureDb().prepare(
      `SELECT * FROM memory_items
       WHERE is_deleted = 0 AND instr(LOWER(content_text), LOWER(?)) > 0
       ORDER BY updated_at DESC LIMIT 200`
    ).all(query.trim()).map(mapMemoryRow)
  }

  public getDailyConversationLogs(dayKey: string): Array<{ content: string }> {
    const db = this.ensureDb()
    const rows = db
      .prepare(
        `SELECT content_md
         FROM active_memory_items
         WHERE day_key = ?
           AND scope = 'daily'
           AND source_type = 'conversation'
           AND is_deleted = 0
         ORDER BY created_at ASC
         LIMIT 200`
      )
      .all(dayKey)

    return rows.map((row) => ({
      content: String(row['content_md'] || '')
    }))
  }

  public getDailySummaryItem(dayKey: string): MemoryRecord | null {
    const db = this.ensureDb()
    const row = db
      .prepare(
        `SELECT *
         FROM active_memory_items
         WHERE scope = 'daily'
           AND kind = 'summary'
           AND day_key = ?
           AND is_deleted = 0
         ORDER BY updated_at DESC
         LIMIT 1`
      )
      .get(dayKey)

    return row ? mapMemoryRow(row) : null
  }

  public markDiscussionExpired(nowTs: number): number {
    const db = this.ensureDb()
    const result = db
      .prepare(
        `UPDATE memory_items
         SET is_deleted = 1, updated_at = ?
         WHERE scope IN ('discussion', 'temporary')
           AND is_deleted = 0
           AND expires_at IS NOT NULL
           AND expires_at <= ?`
      )
      .run(nowTs, nowTs)

    return Number(result.changes || 0)
  }

  public softDeleteDiscussionOlderThan(cutoffTs: number, nowTs: number): number {
    const db = this.ensureDb()
    const result = db
      .prepare(
        `UPDATE memory_items
         SET is_deleted = 1, updated_at = ?
         WHERE scope = 'discussion'
           AND is_deleted = 0
           AND is_pinned = 0
           AND created_at <= ?`
      )
      .run(nowTs, cutoffTs)

    return Number(result.changes || 0)
  }

  public softDeleteDailyNonSummaryOlderThan(
    cutoffTs: number,
    nowTs: number
  ): number {
    const db = this.ensureDb()
    const result = db
      .prepare(
        `UPDATE memory_items
         SET is_deleted = 1, updated_at = ?
         WHERE scope = 'daily'
           AND kind != 'summary'
           AND is_deleted = 0
           AND is_pinned = 0
           AND created_at <= ?`
      )
      .run(nowTs, cutoffTs)

    return Number(result.changes || 0)
  }

  public listSoftDeletedPersistentEntries(
    olderThanTs: number,
    limit = 2_000
  ): Array<{ id: string, createdAt: number }> {
    const db = this.ensureDb()
    return db
      .prepare(
        `SELECT id, created_at
         FROM memory_items
         WHERE scope = 'persistent'
           AND is_deleted = 1
           AND updated_at <= ?
         ORDER BY updated_at ASC
         LIMIT ?`
      )
      .all(olderThanTs, limit)
      .map((row) => ({
        id: String(row['id'] || ''),
        createdAt: Number(row['created_at'] || 0)
      }))
      .filter(
        (entry) =>
          entry.id.length > 0 &&
          Number.isFinite(entry.createdAt) &&
          entry.createdAt > 0
      )
  }

  public purgeSoftDeleted(olderThanTs: number): number {
    const db = this.ensureDb()

    const deletedItemRows = db
      .prepare(
        `DELETE FROM memory_items
         WHERE is_deleted = 1
           AND updated_at <= ?`
      )
      .run(olderThanTs)

    const deletedFactRows = db
      .prepare(
        `DELETE FROM memory_facts
         WHERE is_deleted = 1
           AND updated_at <= ?`
      )
      .run(olderThanTs)

    const deletedContextRows = db
      .prepare(
        `DELETE FROM context_documents
         WHERE is_deleted = 1
           AND updated_at <= ?`
      )
      .run(olderThanTs)

    return (
      Number(deletedItemRows.changes || 0) +
      Number(deletedFactRows.changes || 0) +
      Number(deletedContextRows.changes || 0)
    )
  }

  public optimizeStorage(): void {
    const db = this.ensureDb()
    db.exec('PRAGMA optimize;')
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);')
  }

  public countActivePersistentItems(): number {
    const db = this.ensureDb()
    const row = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM active_memory_items
         WHERE scope = 'persistent'
           AND is_deleted = 0`
      )
      .get()

    return Number(row?.['count'] || 0)
  }

  public countDailySummaryItems(): number {
    const db = this.ensureDb()
    const row = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM active_memory_items
         WHERE scope = 'daily'
           AND kind = 'summary'
           AND is_deleted = 0`
      )
      .get()

    return Number(row?.['count'] || 0)
  }

  public countActiveDiscussionDays(): number {
    const db = this.ensureDb()
    const row = db
      .prepare(
        `SELECT COUNT(DISTINCT day_key) AS count
         FROM active_memory_items
         WHERE scope = 'discussion'
           AND is_deleted = 0
           AND day_key IS NOT NULL`
      )
      .get()

    return Number(row?.['count'] || 0)
  }

  public listPersistentMirrorRecords(): MemoryRecord[] {
    const db = this.ensureDb()
    const rows = db
      .prepare(
        `SELECT *
         FROM active_memory_items
         WHERE scope = 'persistent'
           AND is_deleted = 0
         ORDER BY created_at ASC`
      )
      .all()

    return rows.map((row) => mapMemoryRow(row as Record<string, unknown>))
  }

  public listDailySummaryMirrorRecords(): MemoryRecord[] {
    const db = this.ensureDb()
    const rows = db
      .prepare(
        `SELECT *
         FROM active_memory_items
         WHERE scope = 'daily'
           AND kind = 'summary'
           AND is_deleted = 0
         ORDER BY updated_at DESC`
      )
      .all()

    return rows.map((row) => mapMemoryRow(row as Record<string, unknown>))
  }

  public listDiscussionMirrorRecords(): MemoryRecord[] {
    const db = this.ensureDb()
    const rows = db
      .prepare(
        `SELECT *
         FROM active_memory_items
         WHERE scope = 'discussion'
           AND is_deleted = 0
           AND day_key IS NOT NULL
         ORDER BY day_key ASC, created_at ASC`
      )
      .all()

    return rows.map((row) => mapMemoryRow(row as Record<string, unknown>))
  }

  public listRecentPersistentContents(limit = 200): string[] {
    const db = this.ensureDb()
    return db
      .prepare(
        `SELECT content_text
         FROM active_memory_items
         WHERE scope = 'persistent'
           AND is_deleted = 0
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(limit)
      .map((row) => String(row['content_text'] || '').trim())
      .filter((value) => value.length > 0)
  }

  public listMemoryItemsForRecall(
    scopes: MemoryScope[],
    limit = 500
  ): Array<{
    id: string
    scope: MemoryScope
    kind: string
    title: string | null
    content: string
    updatedAt: number
  }> {
    const db = this.ensureDb()
    if (scopes.length === 0) {
      return []
    }

    const placeholders = scopes.map(() => '?').join(',')
    const rows = db
      .prepare(
        `SELECT id, scope, kind, title, content_text, updated_at
         FROM active_memory_items
         WHERE is_deleted = 0
           AND scope IN (${placeholders})
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(...scopes, limit)

    return rows.map((row) => ({
      id: String(row['id'] || ''),
      scope: String(row['scope'] || 'discussion') as MemoryScope,
      kind: String(row['kind'] || 'note'),
      title: row['title'] ? String(row['title']) : null,
      content: String(row['content_text'] || ''),
      updatedAt: Number(row['updated_at'] || Date.now())
    }))
  }

  public softDeleteById(id: string): boolean {
    const db = this.ensureDb()
    const result = db
      .prepare(
        `UPDATE memory_items
         SET is_deleted = 1, updated_at = ?
         WHERE id = ? AND is_deleted = 0`
      )
      .run(Date.now(), id)

    return Number(result.changes || 0) > 0
  }

  public getFactsTop(limit: number): RecallResult['facts'] {
    const db = this.ensureDb()
    const rows = db
      .prepare(
        `SELECT fact_key, fact_value_json, canonical_text, priority,
                source_item_id, source_type, source_ref
         FROM active_memory_facts
         WHERE is_deleted = 0
         ORDER BY priority DESC, updated_at DESC
         LIMIT ?`
      )
      .all(limit)

    return rows.map((row) => {
      let value: unknown = null
      try {
        value = JSON.parse(String(row['fact_value_json'] || 'null'))
      } catch {
        value = String(row['fact_value_json'] || '')
      }

      return {
        itemId: String(row['source_item_id']),
        sourceType: String(row['source_type']) as MemoryRecord['sourceType'],
        sourceRef: row['source_ref'] ? String(row['source_ref']) : null,
        key: String(row['fact_key'] || ''),
        value,
        text: String(row['canonical_text'] || ''),
        priority: Number(row['priority'] || 0)
      }
    })
  }

  public upsertFact(
    key: string,
    value: unknown,
    text: string,
    sourceItemId: string,
    priority = 50
  ): void {
    const db = this.ensureDb()
    const now = Date.now()
    const existing = db
      .prepare(
        `SELECT id
         FROM memory_facts
         WHERE fact_key = ? AND is_deleted = 0
         LIMIT 1`
      )
      .get(key)

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
        JSON.stringify(value),
        text,
        sourceItemId,
        priority,
        now,
        now,
        existing['id']
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
      key,
      JSON.stringify(value),
      text,
      priority,
      sourceItemId,
      now,
      now,
      now
    )
  }

  public debugHealthCheck(): void {
    if (!this.db) {
      LogHelper.title('Memory Manager')
      LogHelper.warning('Memory repository is not ready')
    }
  }
}
