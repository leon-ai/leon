import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import SQLite from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PULSE_INSIGHTS_RETENTION_DAYS, PulseTickOutcome, type PulseTick } from '@/core/insights/insights-contract'
import {
  MAX_OPEN_PULSE_MATTERS, PULSE_STATE_FILENAME, PulseArchiveReason, PulseDecision, PulseResultRepository,
  type PulseFollowUp, type PulseMatterLead, type PulseTickNote
} from '@/core/pulse-manager/pulse-result-repository'

const HOUR_MS = 60 * 60 * 1_000
const NOW = Date.parse('2028-01-15T08:00:00Z')

function lead(id: string, confidence: number): PulseMatterLead {
  return {
    fingerprint: id, intentKey: 'prepare_demo', targetScope: id, summary: id,
    why: 'I can help prepare the proposal.', turnPrompt: 'Check whether proposals are open.',
    confidence, sessionId: 'source'
  }
}

function followUp(checkAt = NOW + HOUR_MS, expiresAt = NOW + 3 * HOUR_MS): PulseFollowUp {
  return { question: 'Check the published schedule.', checkAt, expiresAt }
}

function record(
  repository: PulseResultRepository, matter: PulseMatterLead, id: string,
  findingKey: string | null, checkedAt: number, next: PulseFollowUp | null,
  scheduledCheckAt?: number
): void {
  repository.record({
    id, matterId: matter.fingerprint, sessionId: 'source', summary: matter.summary, reason: matter.why,
    checkedAt: new Date(checkedAt).toISOString(), findingKey,
    decision: findingKey === null ? PulseDecision.Silent : PulseDecision.Save,
    output: findingKey === null ? null : 'Verified schedule.'
  }, matter, next, scheduledCheckAt)
}

describe('Pulse agenda', () => {
  let directory: string
  let repository: PulseResultRepository

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leon-pulse-'))
    repository = new PulseResultRepository(directory)
  })

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it('keeps due matters and displaces weaker deferred work at capacity', () => {
    const due = lead('due', 0.2)
    const weaker = lead('weaker', 0.4)
    record(repository, due, 'due-first', 'schedule', NOW - HOUR_MS, followUp(NOW))
    record(repository, weaker, 'weaker-first', 'schedule', NOW, followUp())

    for (let index = 0; index < MAX_OPEN_PULSE_MATTERS - 2; index++) {
      record(repository, lead(`proposal-${index}`, 0.8), `finding-${index}`, 'schedule', NOW, followUp())
    }

    const stronger = lead('stronger', 0.9)
    record(repository, stronger, 'stronger-first', 'schedule', NOW, followUp())
    const open = repository.openMatters(NOW).map(({ lead: matter }) => matter.fingerprint)
    expect(open).toHaveLength(MAX_OPEN_PULSE_MATTERS)
    expect(open[0]).toBe(due.fingerprint)
    expect(open).toContain(stronger.fingerprint)
    expect(open).not.toContain(weaker.fingerprint)
    expect(repository.recentFindings(weaker.fingerprint)).toHaveLength(1)
  })

  it('expires completed opportunities and reopens their history only for a new finding', () => {
    const matter = lead('showcase', 0.9)
    const original = followUp()
    record(repository, matter, 'original', 'schedule_published', NOW, original)
    repository.prune(original.expiresAt)
    expect(repository.openMatters(original.expiresAt)).toEqual([])

    const reopenedAt = original.expiresAt + 1_000
    const next = followUp(reopenedAt + HOUR_MS, reopenedAt + 3 * HOUR_MS)
    record(repository, matter, 'duplicate', 'schedule_published', reopenedAt, next)
    expect(repository.openMatters(reopenedAt)).toEqual([])

    record(repository, matter, 'new-slot', 'monday_slot', reopenedAt, next)
    expect(repository.openMatters(reopenedAt).map(({ lead: item }) => item.fingerprint)).toEqual([matter.fingerprint])
    expect(repository.recentFindings(matter.fingerprint).map((finding) => finding.findingKey))
      .toEqual(['monday_slot', 'schedule_published'])

    record(repository, matter, 'finished', null, next.checkAt, null, next.checkAt)
    expect(repository.openMatters(next.checkAt)).toEqual([])
  })

  it('trims old silence while keeping archived findings and owner declines', () => {
    const matter = lead('showcase', 0.9)
    record(repository, matter, 'found', 'schedule', NOW, followUp())
    record(repository, matter, 'silent', null, NOW, null)
    repository.archive(matter.fingerprint, PulseArchiveReason.Declined, NOW)
    repository.prune(NOW + 31 * 24 * HOUR_MS)

    const db = new SQLite(path.join(directory, 'pulse.sqlite'), { readonly: true })
    try {
      expect(db.prepare('SELECT id FROM results').all()).toEqual([{ id: 'found' }])
      expect(db.prepare('SELECT archive_reason FROM matters').get())
        .toEqual({ archive_reason: PulseArchiveReason.Declined })
    } finally {
      db.close()
    }
  })

  it('keeps the resolving conversation and ignores a scheduled result that finishes after it', () => {
    const matter = lead('showcase', 0.9)
    const next = followUp()
    record(repository, matter, 'follow-up', 'schedule', NOW, next)
    const [open] = repository.openMatters(NOW)
    expect(open).toBeDefined()

    const source = { sessionId: 'owner-chat', messageId: 'owner-answer', quote: 'The showcase organizer confirmed the demo.' }
    expect(repository.resolveInChat(open!, source, next.checkAt)).toBe(true)
    record(repository, matter, 'stale-research-result', 'new-slot', next.checkAt + 1_000, next, next.checkAt)
    expect(repository.openMatters(next.checkAt)).toEqual([])
    expect(repository.recentFindings(matter.fingerprint)).toHaveLength(2)

    const db = new SQLite(path.join(directory, 'pulse.sqlite'), { readonly: true })
    try {
      expect(db.prepare('SELECT session_id, source_message_id FROM results WHERE decision = ?')
        .get(PulseDecision.ResolvedInChat)).toEqual({
        session_id: source.sessionId, source_message_id: source.messageId
      })
    } finally {
      db.close()
    }
  })

  it('paginates retained ticks without changing their totals or the next follow-up', () => {
    const matter = lead('showcase', 0.9)
    const next = followUp()
    record(repository, matter, 'agenda-result', 'schedule', NOW, next)

    const quiet: PulseTick = {
      id: 'quiet', outcome: PulseTickOutcome.Quiet, investigated: true, trigger: 'scheduled',
      startedAt: NOW - HOUR_MS, durationMs: 2_000, matter: matter.summary,
      events: [{ at: NOW - HOUR_MS, phase: 'review', code: 'silent', detail: 'The schedule has not changed.' }]
    }
    const stale: PulseTick = {
      ...quiet, id: 'older', startedAt: NOW - (PULSE_INSIGHTS_RETENTION_DAYS + 1) * 24 * HOUR_MS
    }
    repository.recordTick(stale)
    repository.recordTick(quiet)
    const idle = Array.from({ length: 30 }, (_, index): PulseTick => ({
      ...quiet, id: `idle-${index}`, outcome: PulseTickOutcome.Idle, investigated: false,
      startedAt: NOW - index * 1_000, matter: null,
      events: [{ at: NOW - index * 1_000, phase: 'planning', code: 'no_lead', detail: 'No useful lead was due.' }]
    }))
    for (const tick of idle) {
      repository.recordTick(tick)
    }

    const reopened = new PulseResultRepository(directory)
    const first = reopened.readTickHistory(0, true, NOW)
    const second = reopened.readTickHistory(1, true, NOW)
    expect(first.pages).toBeGreaterThan(1)
    expect(first).toMatchObject({
      total: idle.length + 1, investigated: 1,
      outcomes: { [PulseTickOutcome.Idle]: idle.length, [PulseTickOutcome.Quiet]: 1 },
      nextFollowUp: { matter: matter.summary, ...next }
    })
    expect(second).toMatchObject({ total: first.total, investigated: 1, nextFollowUp: first.nextFollowUp })
    expect([...first.ticks, ...second.ticks]).toEqual([...idle, quiet])
  })

  it('recovers earlier notes and results once while keeping existing audit entries authoritative', () => {
    const matter = lead('showcase', 0.9)
    const earlierAt = NOW - 2 * HOUR_MS
    const modernAt = NOW - HOUR_MS
    record(repository, matter, 'earlier-finding', 'schedule', earlierAt, null)
    record(repository, matter, 'modern-check', null, modernAt, null)
    const modern: PulseTick = {
      id: 'modern', outcome: PulseTickOutcome.Quiet, investigated: true,
      trigger: 'scheduled', startedAt: modernAt, durationMs: 2_000, matter: matter.summary,
      events: [{ at: modernAt, phase: 'review', code: 'silent', detail: 'The schedule has not changed.' }]
    }
    repository.recordTick(modern)

    const notes: PulseTickNote[] = [
      { at: new Date(modernAt + 1_000).toISOString(), outcome: 'executed', note: 'silent: showcase', matterId: 'modern-check' },
      { at: new Date(earlierAt + 1_000).toISOString(), outcome: 'executed', note: 'save: showcase', matterId: 'earlier-finding' },
      { at: new Date(earlierAt - 1_000).toISOString(), outcome: 'queued', note: 'Checking the showcase.', matterId: 'earlier-finding' },
      { at: new Date(earlierAt - HOUR_MS).toISOString(), outcome: 'skipped', note: 'The model was unavailable.', matterId: null }
    ]
    fs.writeFileSync(path.join(directory, PULSE_STATE_FILENAME), JSON.stringify({ recentTicks: notes }))
    const existing = new SQLite(path.join(directory, 'pulse.sqlite'))
    try {
      // Existing Pulse databases can contain audit entries before the schema version is set.
      existing.exec('PRAGMA user_version = 0')
    } finally {
      existing.close()
    }

    const history = new PulseResultRepository(directory).readTickHistory(0, true, NOW)
    expect(history).toMatchObject({
      total: 3, investigated: 2,
      outcomes: { [PulseTickOutcome.Saved]: 1, [PulseTickOutcome.Quiet]: 1, [PulseTickOutcome.Skipped]: 1 },
      ticks: [
        modern,
        { outcome: PulseTickOutcome.Saved, recovered: true, trigger: null, durationMs: null, events: [
          { code: 'recorded_reason', detail: matter.why },
          { code: 'recorded_result', detail: 'Verified schedule.' },
          { code: 'recorded_note', detail: 'save: showcase' }
        ] },
        { outcome: PulseTickOutcome.Skipped, recovered: true, investigated: false,
          events: [{ code: 'recorded_note', detail: 'The model was unavailable.' }] }
      ]
    })
    expect(new PulseResultRepository(directory).readTickHistory(0, true, NOW)).toEqual(history)
  })

  it('recovers an earlier Pulse that ended before any investigation was saved', () => {
    const note: PulseTickNote = {
      at: new Date(NOW - HOUR_MS).toISOString(), outcome: 'idle',
      note: 'No pulse matter selected (scheduled)', matterId: null
    }
    fs.writeFileSync(path.join(directory, PULSE_STATE_FILENAME), JSON.stringify({ recentTicks: [note] }))

    expect(repository.readTickHistory(0, true, NOW)).toMatchObject({
      total: 1, investigated: 0, outcomes: { [PulseTickOutcome.Idle]: 1 },
      ticks: [{ outcome: PulseTickOutcome.Idle, recovered: true, events: [{ detail: note.note }] }]
    })
  })
})
