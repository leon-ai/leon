import fs from 'node:fs'
import path from 'node:path'

import SQLite, { type Database } from 'better-sqlite3'

export enum PulseDecision {
  Silent = 'silent',
  Save = 'save',
  Notify = 'notify',
  Failed = 'failed'
}

export interface PulseResult {
  id: string
  matterId: string
  sessionId: string
  summary: string
  reason: string
  decision: PulseDecision
  findingKey: string | null
  output: string | null
  checkedAt: string
}

const RECENT_FINDINGS_LIMIT = 5

/**
 * Keeps each research result under its matter, independently of the current queue.
 */
export class PulseResultRepository {
  private db: Database | undefined

  public constructor(private readonly directory: string) {}

  public record(result: PulseResult): boolean {
    return this.database().prepare(`
      INSERT INTO results (
        id, matter_id, session_id, summary, reason, decision, finding_key, output, checked_at
      )
      VALUES (@id, @matterId, @sessionId, @summary, @reason, @decision, @findingKey, @output, @checkedAt)
      ON CONFLICT (matter_id, finding_key) WHERE decision = 'notify' DO NOTHING
    `).run(result).changes === 1
  }

  public saveUndelivered(id: string): void {
    this.database().prepare('UPDATE results SET decision = ? WHERE id = ? AND decision = ?')
      .run(PulseDecision.Save, id, PulseDecision.Notify)
  }

  public recentFindings(matterId: string): Array<Pick<PulseResult, 'decision' | 'findingKey' | 'output'>> {
    return this.database().prepare(`
      SELECT decision, finding_key AS findingKey, output
      FROM results
      WHERE matter_id = ? AND decision IN ('save', 'notify')
      ORDER BY checked_at DESC
      LIMIT ?
    `).all(matterId, RECENT_FINDINGS_LIMIT) as Array<Pick<PulseResult, 'decision' | 'findingKey' | 'output'>>
  }

  private database(): Database {
    if (!this.db) {
      fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 })
      const db = new SQLite(path.join(this.directory, 'pulse.sqlite'))
      db.exec(`
        CREATE TABLE IF NOT EXISTS results (
          id TEXT PRIMARY KEY,
          matter_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          summary TEXT NOT NULL,
          reason TEXT NOT NULL,
          decision TEXT NOT NULL,
          finding_key TEXT,
          output TEXT,
          checked_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS results_by_matter ON results (matter_id, checked_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS reported_findings
          ON results (matter_id, finding_key) WHERE decision = 'notify';
      `)
      this.db = db
    }

    return this.db
  }
}
