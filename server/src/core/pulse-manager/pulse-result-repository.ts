import fs from 'node:fs'
import path from 'node:path'

import SQLite, { type Database } from 'better-sqlite3'
import { measurePulse } from '@/core/telemetry/pulse-measurements'

export enum PulseDecision {
  Silent = 'silent',
  Save = 'save',
  Notify = 'notify',
  Failed = 'failed',
  ResolvedInChat = 'resolved_in_chat'
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

export interface PulseMatterLead {
  fingerprint: string
  intentKey: string
  targetScope: string
  summary: string
  why: string
  turnPrompt: string
  confidence: number
  sessionId: string | null
}

export interface PulseFollowUp {
  question: string
  checkAt: number
  expiresAt: number
}

interface OpenPulseMatter {
  lead: PulseMatterLead
  checkAt: number
  expiresAt: number
  updatedAt: number
}

export enum PulseArchiveReason {
  Resolved = 'resolved',
  ResolvedInChat = 'resolved_in_chat',
  CheckFailed = 'check_failed',
  Expired = 'expired',
  Displaced = 'displaced',
  Declined = 'declined',
  SourceRemoved = 'source_removed'
}

const RECENT_FINDINGS_LIMIT = 5
const RECENT_ARCHIVED_MATTERS_LIMIT = 12
export const MAX_OPEN_PULSE_MATTERS = 6
const SILENT_RESULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000

/**
 * Keeps each research result under its matter, independently of the current queue.
 */
export class PulseResultRepository {
  private db: Database | undefined
  private readonly databasePath: string

  public constructor(private readonly directory: string) {
    this.databasePath = path.join(directory, 'pulse.sqlite')
  }

  /**
   * Commit the result and its effect on the matter together so a finished follow-up cannot run twice.
   */
  public record(
    result: PulseResult,
    lead: PulseMatterLead,
    followUp: PulseFollowUp | null,
    scheduledCheckAt?: number
  ): boolean {
    const db = this.database()
    const { recorded, newFinding, agenda, expired } = db.transaction(() => {
      if (scheduledCheckAt !== undefined && !db.prepare(`
        SELECT 1 FROM matters WHERE id = ? AND check_at = ? AND archive_reason IS NULL
      `).get(result.matterId, scheduledCheckAt)) {
        return { recorded: false, newFinding: false }
      }

      const knownFinding = result.findingKey && db.prepare(`
        SELECT 1 FROM results WHERE matter_id = ? AND finding_key = ? LIMIT 1
      `).get(result.matterId, result.findingKey)
      const insert = db.prepare(`
      INSERT INTO results (
        id, matter_id, session_id, summary, reason, decision, finding_key, output, checked_at
      )
      VALUES (@id, @matterId, @sessionId, @summary, @reason, @decision, @findingKey, @output, @checkedAt)
      ON CONFLICT (matter_id, finding_key) WHERE decision = 'notify' DO NOTHING
      `)
      const recorded = !(knownFinding && result.decision === PulseDecision.Save) &&
        insert.run(result).changes === 1
      if (!recorded) {
        insert.run({ ...result, decision: PulseDecision.Silent, findingKey: null, output: null })
      }

      const now = Date.parse(result.checkedAt)
      const newFinding = Boolean(recorded && result.findingKey && !knownFinding)
      if (newFinding) {
        return { recorded, newFinding, agenda: this.updateMatter(lead, followUp, now) }
      }
      if (scheduledCheckAt !== undefined) {
        const matter = db.prepare(`
          UPDATE matters SET archive_reason = CASE WHEN expires_at <= @now THEN @expired ELSE @finished END,
            updated_at = @now
          WHERE id = @id AND archive_reason IS NULL AND check_at = @checkAt
          RETURNING archive_reason
        `).get({
          id: result.matterId, checkAt: scheduledCheckAt, now,
          expired: PulseArchiveReason.Expired,
          finished: result.decision === PulseDecision.Failed
            ? PulseArchiveReason.CheckFailed
            : PulseArchiveReason.Resolved
        })
        return { recorded, newFinding, expired: matter?.['archive_reason'] === PulseArchiveReason.Expired }
      }

      return { recorded, newFinding }
    })()
    if (newFinding) {
      measurePulse({ counter: 'new_findings', count: 1 })
    }
    if (agenda?.scheduled) {
      measurePulse({ counter: 'scheduled', count: 1 })
    }
    if (agenda?.displaced) {
      measurePulse({ counter: 'displaced', count: 1 })
    }
    if (expired) {
      measurePulse({ counter: 'expired', count: 1 })
    }
    return recorded
  }

  /**
   * Retires expired work and reduces routine silence while retaining useful findings.
   */
  public prune(now: number): void {
    const db = this.existingDatabase()
    if (!db) {
      return
    }

    const expired = db.prepare(`
      UPDATE matters SET archive_reason = ?, updated_at = ?
      WHERE archive_reason IS NULL AND expires_at <= ?
    `).run(PulseArchiveReason.Expired, now, now)
    if (expired.changes) {
      measurePulse({ counter: 'expired', count: Number(expired.changes) })
    }
    db.prepare('DELETE FROM results WHERE decision = ? AND checked_at < ?')
      .run(PulseDecision.Silent, new Date(now - SILENT_RESULT_RETENTION_MS).toISOString())
  }

  /**
   * Lists the bounded agenda in execution order, with ties favoring nearer expiry.
   */
  public openMatters(now: number): OpenPulseMatter[] {
    const rows = this.existingDatabase()?.prepare(`
      SELECT lead, check_at AS checkAt, expires_at AS expiresAt, updated_at AS updatedAt
      FROM matters WHERE archive_reason IS NULL AND expires_at > @now
      ORDER BY check_at > @now, CASE WHEN check_at <= @now THEN expires_at ELSE check_at END,
        priority DESC, id
    `).all({ now }) as Array<Omit<OpenPulseMatter, 'lead'> & { lead: string }> | undefined

    return rows?.map((row) => ({
      ...row, lead: JSON.parse(row.lead) as PulseMatterLead
    })) ?? []
  }

  /**
   * Supplies existing identities when a previously closed subject becomes relevant again.
   */
  public recentArchivedMatters(): Array<PulseMatterLead & { archiveReason: PulseArchiveReason }> {
    const rows = this.existingDatabase()?.prepare(`
      SELECT lead, archive_reason AS archiveReason FROM matters WHERE archive_reason IS NOT NULL
      ORDER BY updated_at DESC, id LIMIT ?
    `).all(RECENT_ARCHIVED_MATTERS_LIMIT) as Array<{ lead: string, archiveReason: PulseArchiveReason }> | undefined

    return rows?.map((row) => ({
      ...(JSON.parse(row.lead) as PulseMatterLead), archiveReason: row.archiveReason
    })) ?? []
  }

  public archive(id: string, reason: PulseArchiveReason, now: number): void {
    this.existingDatabase()?.prepare(`
      UPDATE matters SET archive_reason = ?, updated_at = ? WHERE id = ? AND archive_reason IS NULL
    `).run(reason, now, id)
  }

  /**
   * Closes the exact open revision reviewed in chat and records the original turn.
   */
  public resolveInChat(
    matter: OpenPulseMatter,
    source: { sessionId: string, messageId: string, quote: string },
    now: number
  ): boolean {
    const db = this.database()
    const { lead, updatedAt } = matter

    return db.transaction(() => {
      const changed = db.prepare(`
        UPDATE matters SET archive_reason = ?, updated_at = ?
        WHERE id = ? AND archive_reason IS NULL AND updated_at = ? AND expires_at > ?
      `).run(PulseArchiveReason.ResolvedInChat, now, lead.fingerprint, updatedAt, now).changes
      if (!changed) {
        return false
      }

      db.prepare(`
        INSERT INTO results (id, matter_id, session_id, source_message_id, summary, reason, decision, output, checked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `chat:${lead.fingerprint}:${source.sessionId}:${source.messageId}`,
        lead.fingerprint, source.sessionId, source.messageId, lead.summary,
        'I found the answer to this matter in our conversation.',
        PulseDecision.ResolvedInChat, source.quote, new Date(now).toISOString()
      )

      return true
    })()
  }

  private updateMatter(lead: PulseMatterLead, followUp: PulseFollowUp | null, now: number): { scheduled: boolean, displaced: boolean } {
    const db = this.database()
    const existing = db.prepare('SELECT archive_reason FROM matters WHERE id = ?')
      .get(lead.fingerprint)
    let archiveReason: PulseArchiveReason | null = PulseArchiveReason.Resolved
    let displaced = false

    if (followUp) {
      archiveReason = null
      if (existing?.['archive_reason'] !== null) {
        const open = this.openMatters(now)
        if (open.length >= MAX_OPEN_PULSE_MATTERS) {
          displaced = true
          // A due check already has a reason to run. Replace only lower-value deferred work.
          const weakest = open.filter((matter) => matter.checkAt > now)
            .sort((left, right) => left.lead.confidence - right.lead.confidence ||
              right.expiresAt - left.expiresAt)[0]
          if (weakest && weakest.lead.confidence < lead.confidence) {
            this.archive(weakest.lead.fingerprint, PulseArchiveReason.Displaced, now)
          } else {
            archiveReason = PulseArchiveReason.Displaced
          }
        }
      }
    }

    const nextLead: PulseMatterLead = {
      fingerprint: lead.fingerprint,
      intentKey: lead.intentKey,
      targetScope: lead.targetScope,
      summary: lead.summary,
      why: lead.why,
      turnPrompt: followUp?.question ?? lead.turnPrompt,
      confidence: lead.confidence,
      sessionId: lead.sessionId
    }
    db.prepare(`
      INSERT INTO matters (id, lead, priority, check_at, expires_at, archive_reason, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET lead = excluded.lead, priority = excluded.priority,
        check_at = excluded.check_at, expires_at = excluded.expires_at,
        archive_reason = excluded.archive_reason, updated_at = excluded.updated_at
    `).run(
      lead.fingerprint, JSON.stringify(nextLead), lead.confidence,
      followUp?.checkAt ?? null, followUp?.expiresAt ?? null, archiveReason, now
    )
    return { scheduled: archiveReason === null, displaced }
  }

  public saveUndelivered(id: string): void {
    this.database().prepare('UPDATE results SET decision = ? WHERE id = ? AND decision = ?')
      .run(PulseDecision.Save, id, PulseDecision.Notify)
  }

  public recentFindings(matterId: string): Array<Pick<PulseResult, 'decision' | 'findingKey' | 'output'>> {
    return this.database().prepare(`
      SELECT decision, finding_key AS findingKey, output
      FROM results
      WHERE matter_id = ? AND decision IN ('save', 'notify', 'resolved_in_chat')
      ORDER BY checked_at DESC
      LIMIT ?
    `).all(matterId, RECENT_FINDINGS_LIMIT) as Array<Pick<PulseResult, 'decision' | 'findingKey' | 'output'>>
  }

  private existingDatabase(): Database | undefined {
    return this.db || (fs.existsSync(this.databasePath) ? this.database() : undefined)
  }

  private database(): Database {
    if (!this.db) {
      fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 })
      const db = new SQLite(this.databasePath)
      db.exec(`
        CREATE TABLE IF NOT EXISTS results (
          id TEXT PRIMARY KEY,
          matter_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          source_message_id TEXT,
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
        CREATE INDEX IF NOT EXISTS results_by_finding ON results (matter_id, finding_key);
        CREATE INDEX IF NOT EXISTS results_by_decision ON results (decision, checked_at);
        CREATE TABLE IF NOT EXISTS matters (
          id TEXT PRIMARY KEY,
          lead TEXT NOT NULL,
          priority REAL NOT NULL,
          check_at INTEGER,
          expires_at INTEGER,
          archive_reason TEXT,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS open_matters_by_check
          ON matters (check_at) WHERE archive_reason IS NULL;
        CREATE INDEX IF NOT EXISTS archived_matters_by_age
          ON matters (updated_at DESC) WHERE archive_reason IS NOT NULL;
      `)
      if (!db.prepare('SELECT 1 FROM pragma_table_info(\'results\') WHERE name = \'source_message_id\'').get()) {
        db.exec('ALTER TABLE results ADD COLUMN source_message_id TEXT')
      }
      this.db = db
    }

    return this.db
  }
}
