import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import SQLite, { type Database } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MemoryManager from '@/core/memory-manager/memory-manager'
import MemoryRepository from '@/core/memory-manager/memory-repository'
import type { MemoryRecord, MemoryWriteInput } from '@/core/memory-manager/types'
import { upgradeMemoryScope } from '@@/scripts/setup/migrations/2026102907370753-add-temporary-memory-scope.js'
import { DEFAULT_TEMPORARY_MEMORY_POLICY, getTemporaryContextSize } from '@@/bridges/runtime/nodejs/temporary-memory'

const state = vi.hoisted(() => ({
  root: '',
  rows: [] as Array<Record<string, unknown>>,
  settings: {} as Record<string, unknown>,
  prompt: vi.fn()
}))

vi.mock('@/constants', () => ({ CODEBASE_PATH: process.cwd(), MEMORY_EXTRACTION_MAX_BATCH_TURNS: 3 }))
vi.mock('@/helpers/log-helper', () => ({
  LogHelper: { title: vi.fn(), info: vi.fn(), success: vi.fn(), debug: vi.fn(), warning: vi.fn(), error: vi.fn() }
}))
vi.mock('@/core/profile-runtime/profile-paths', () => ({
  getProfilePaths: (): { name: string, memory: string, context: string } => ({
    name: 'memory-test', memory: state.root, context: `${state.root}/context`
  })
}))
vi.mock('@/core/config-states/config-state', () => ({
  CONFIG_STATE: {
    getModelState: (): { getWorkflowProvider: () => string } => ({
      getWorkflowProvider: (): string => 'openai'
    })
  }
}))
vi.mock('@/core', () => ({ LLM_PROVIDER: { prompt: state.prompt } }))
vi.mock('@/core/tool-manager/tool-settings', () => ({
  ToolSettings: { loadToolSettings: (): Record<string, unknown> => state.settings }
}))
vi.mock('@/core/memory-manager/qmd/qmd-store', () => ({
  QMDWriteLockTimeoutError: class extends Error {},
  getQMDStore: vi.fn(async () => ({})),
  updateQMDStore: vi.fn(async () => undefined),
  getQMDStoreStatus: vi.fn(async () => ({ needsEmbedding: 0 })),
  embedQMDStore: vi.fn(async () => undefined),
  runQMDStoreSearch: vi.fn(async ({ collectionNames }: { collectionNames: string[] }) =>
    state.rows.filter((row) => collectionNames.includes(String(row['collection'])))
  )
}))

describe('memory lifecycle', () => {
  let manager: MemoryManager
  let repository: MemoryRepository

  beforeEach(async () => {
    state.root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'leon-memory-'))
    state.rows = []
    state.settings = {}
    state.prompt.mockReset()
    repository = new MemoryRepository()
    await repository.load(path.join(state.root, 'memory.sqlite'))
    manager = new MemoryManager()
    // Exercise memory operations without scheduling unrelated boot maintenance.
    Object.assign(manager, { repository, _isLoaded: true })
  })

  afterEach(async () => {
    const { db } = repository as unknown as { db: Database }
    db.close()
    await fs.promises.rm(state.root, { recursive: true, force: true })
  })

  async function remember(content: string, options: Partial<MemoryWriteInput> = {}): Promise<MemoryRecord> {
    return manager.remember({
      scope: 'persistent', kind: 'fact', content, sourceType: 'explicit_user',
      sourceRef: 'session:owner:turn:1', ...options
    })
  }

  function mirrorPath(record: MemoryRecord): string {
    if (record.scope !== 'persistent') {
      return path.join(state.root, record.scope, `${record.dayKey}.md`)
    }
    const datePath = new Date(record.createdAt).toISOString().slice(0, 10).split('-')
    return path.join(state.root, 'persistent', ...datePath, `${record.id}.md`)
  }

  function indexSnapshot(record: MemoryRecord, content = record.content): void {
    state.rows.push({
      docid: `indexed:${record.id}`, filepath: mirrorPath(record),
      collection: `memory-${record.scope}`, title: 'Indexed memory', content, score: 0.9
    })
  }

  async function recall(): Promise<Awaited<ReturnType<MemoryManager['recall']>>> {
    return manager.recall({
      query: 'owner location Lyon Paris',
      namespaces: ['memory_persistent', 'memory_daily', 'memory_discussion'],
      includeFacts: true, tokenBudget: 2_000, topK: 20
    })
  }

  it('excludes expired, forgotten and orphaned evidence even when QMD retains it', async () => {
    const current = await remember('Owner lives in Lyon.')
    const expired = await remember('Owner lives in Paris.', { expiresAt: Date.now() - 1_000, isPinned: true })
    const forgotten = await remember('Owner previously lived in Bordeaux.')
    for (const record of [current, expired, forgotten]) {
      repository.upsertFact(record.id, record.content, record.content, record.id)
      indexSnapshot(record)
    }

    await manager.forgetById(forgotten.id)
    let result = await recall()
    expect(result.hits.map((hit) => hit.itemId)).toEqual([current.id])
    expect(result.hits[0]).toMatchObject({
      sourceType: 'explicit_user', sourceRef: 'session:owner:turn:1', createdAt: current.createdAt
    })
    expect(result.facts.map((fact) => fact.text)).toEqual([current.content])
    expect(fs.existsSync(mirrorPath(forgotten))).toBe(false)

    repository.purgeSoftDeleted(Date.now() + 1_000)
    result = await recall()
    expect(result.hits.map((hit) => hit.itemId)).toEqual([current.id])
    expect(result.facts.map((fact) => fact.text)).toEqual([current.content])
  })

  it('keeps corrections authoritative after duplicate writes, forgetting and cleanup', async () => {
    const old = await remember('Owner lives in Paris.')
    repository.upsertFact('owner.city', 'Paris', old.content, old.id)
    const current = await remember('Owner lives in Lyon.', { supersedesItemId: old.id })
    const duplicate = await remember(current.content)
    expect(duplicate.id).toBe(current.id)
    expect(repository.getActiveMemoryItem(old.id)).toBeNull()
    expect(repository.getFactsTop(10)).toEqual([])
    expect(fs.existsSync(mirrorPath(old))).toBe(false)
    indexSnapshot(old)
    indexSnapshot(current)
    expect((await recall()).hits.map((hit) => hit.itemId)).toEqual([current.id])

    await manager.forgetById(current.id)
    repository.purgeSoftDeleted(Date.now() + 1_000)
    expect((await recall()).hits).toEqual([])
  })

  it('rejects missing and cross-scope correction targets without retiring valid memory', async () => {
    const old = await remember('Owner lives in Paris.')
    await expect(remember('Owner lives in Lyon.', { supersedesItemId: 'unknown' })).rejects.toThrow('active')
    await expect(remember('Owner lives in Lyon.', {
      scope: 'discussion', dayKey: '2026-10-29', supersedesItemId: old.id
    })).rejects.toThrow('same scope')
    expect(repository.getActiveMemoryItem(old.id)?.content).toBe(old.content)
  })

  it('resolves day mirrors to current records without rehydrating retired file content', async () => {
    const dayKey = new Date().toISOString().slice(0, 10)
    const oldSummary = await remember('Owner lives in Paris.', { scope: 'daily', kind: 'summary', dayKey })
    const summary = await remember('Owner lives in Lyon.', {
      scope: 'daily', kind: 'summary', dayKey, supersedesItemId: oldSummary.id
    })
    const oldDiscussion = await remember('Owner lives in Paris.', { scope: 'discussion', dayKey })
    const discussion = await remember('Owner lives in Lyon.', { scope: 'discussion', dayKey })
    await remember(discussion.content, { scope: 'discussion', dayKey })
    const discussionFile = await fs.promises.readFile(mirrorPath(discussion), 'utf8')
    expect(discussionFile.split(discussion.content)).toHaveLength(2)
    await manager.forgetById(oldDiscussion.id)
    expect(await fs.promises.readFile(mirrorPath(discussion), 'utf8')).not.toContain('Paris')

    // A delayed mirror writer and an old index must not override database validity.
    await fs.promises.writeFile(mirrorPath(summary), 'Owner lives in Paris. '.repeat(50))
    await fs.promises.writeFile(mirrorPath(discussion), 'Owner lives in Paris. '.repeat(50))
    indexSnapshot(oldSummary)
    indexSnapshot(oldDiscussion)
    const result = await recall()
    expect(result.hits.length).toBeGreaterThan(0)
    expect(result.hits.every((hit) => [summary.id, discussion.id].includes(hit.itemId))).toBe(true)
    expect(result.promptText).not.toContain('Paris')

    const scoped = await manager.recall({
      query: 'owner location Lyon', namespaces: ['memory_daily', 'memory_discussion'],
      scopes: ['daily'], kinds: ['summary'], dayKeys: [dayKey], tokenBudget: 1_000
    })
    expect(scoped.hits.map((hit) => hit.itemId)).toEqual([summary.id])
  })

  it('preserves explicit provenance and zero-valued confidence when an inferred duplicate arrives', async () => {
    const explicit = await remember('Owner lives in Lyon.', { confidence: 0, importance: 0 })
    const inferred = await remember(explicit.content, {
      sourceType: 'inferred', sourceRef: 'automatic:turn:2', confidence: 0.7
    })
    expect(inferred).toMatchObject({
      id: explicit.id, sourceType: 'explicit_user', sourceRef: explicit.sourceRef,
      confidence: 0, importance: 0
    })
  })

  it('extracts new owner facts and replaces corrected facts with their evidence', async () => {
    const old = await remember('Owner prefers quiet work sessions with no interruptions in the morning.')
    state.prompt.mockResolvedValueOnce({ output: { items: [{
      content: 'Owner prefers quiet work sessions with no interruptions in the evening.',
      evidence: 'My quiet work sessions are now in the evening.', supersedesItemId: old.id
    }] } })
    expect(await manager.saveMemoryCandidatesFromTurn('My quiet work sessions are now in the evening.', 'Noted.', Date.now())).toBe(1)
    expect(repository.getActiveMemoryItem(old.id)).toBeNull()
    expect(state.prompt.mock.calls[0]?.[0]).toContain(old.id)
    state.prompt.mockResolvedValueOnce({ output: { items: [{
      content: 'Owner lives in Lyon.', evidence: 'I moved to Lyon.'
    }] } })
    expect(await manager.saveMemoryCandidatesFromTurn('I moved to Lyon.', 'Noted.', 1_000)).toBe(1)
    const inferred = repository.listPersistentMirrorRecords().find((record) => record.sourceRef === 'turn:1000')
    expect(inferred).toMatchObject({
      sourceType: 'inferred', confidence: 0.7, metadata: { evidence: 'I moved to Lyon.' }
    })
  })

  it('rejects delayed persistent corrections after their selected target changes', async () => {
    const old = await remember('Caldera contact is Mira.')
    state.prompt.mockImplementationOnce(async () => {
      await remember('Caldera contact is Nora.', { supersedesItemId: old.id })
      return { output: { items: [{
        content: 'Caldera contact is Tomas.', evidence: 'Caldera contact is Tomas.',
        supersedesItemId: old.id
      }] } }
    })
    expect(await manager.saveMemoryCandidatesFromTurn('Caldera contact is Tomas.', 'Noted.', Date.now())).toBe(0)
    expect(repository.listPersistentMirrorRecords().map((record) => record.content)).toEqual(['Caldera contact is Nora.'])

    // A queued older turn can start extraction after the newer record already exists.
    const current = repository.listPersistentMirrorRecords()[0]!
    state.prompt.mockResolvedValueOnce({ output: { items: [{
      content: 'Caldera contact is Tomas.', evidence: 'Caldera contact is Tomas.',
      supersedesItemId: current.id
    }] } })
    expect(await manager.saveMemoryCandidatesFromTurn('Caldera contact is Tomas.', 'Noted.', current.updatedAt - 1)).toBe(0)
    expect(repository.getActiveMemoryItem(current.id)?.content).toBe('Caldera contact is Nora.')
  })

  it('validates the correction version inside its write transaction', async () => {
    const old = await remember('Caldera contact is Mira.')
    await expect(remember('Caldera contact is Nora.', {
      supersedesItemId: old.id, expectedSupersededUpdatedAt: old.updatedAt - 1
    })).rejects.toThrow('changed')
    expect(repository.getActiveMemoryItem(old.id)?.content).toBe(old.content)
  })

  it('extracts a bounded backlog once with independent evidence and the latest correction', async () => {
    const old = await remember('Caldera contact is Mira.')
    const sentAt = Date.now()
    state.prompt.mockResolvedValueOnce({ output: { items: [
      { turnIndex: 0, content: 'Caldera contact is Nora.', evidence: 'Caldera contact is Nora.', supersedesItemId: old.id },
      { turnIndex: 1, content: 'Borealis reviews are Friday.', evidence: 'Borealis reviews are Friday.' },
      { turnIndex: 2, content: 'Caldera contact is Tomas.', evidence: 'Caldera contact is Tomas.', supersedesItemId: old.id },
      { turnIndex: 2, content: 'Unsupported fact.', evidence: 'Borealis reviews are Friday.' }
    ] } })
    expect(await manager.saveMemoryCandidatesFromTurns([
      { userMessage: 'Caldera contact is Nora.', assistantMessage: 'Noted.', sentAt, sourceRef: 'source:first' },
      { userMessage: 'Borealis reviews are Friday.', assistantMessage: 'Noted.', sentAt, sourceRef: 'source:second' },
      { userMessage: 'Caldera contact is Tomas.', assistantMessage: 'Noted.', sentAt, sourceRef: 'source:third' }
    ])).toEqual([0, 1, 1])
    expect(state.prompt).toHaveBeenCalledOnce()
    expect(repository.listPersistentMirrorRecords()).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: 'Borealis reviews are Friday.', sourceRef: 'source:second' }),
      expect.objectContaining({ content: 'Caldera contact is Tomas.', sourceRef: 'source:third' })
    ]))
    expect(repository.listPersistentMirrorRecords()).toHaveLength(2)
  })

  it('preserves newer explicit memory when an older backlog begins extraction', async () => {
    const current = await remember('Caldera contact is Tomas.')
    state.prompt.mockResolvedValueOnce({ output: { items: [
      { turnIndex: 0, content: 'Caldera contact is Nora.', evidence: 'Caldera contact is Nora.', supersedesItemId: current.id }
    ] } })
    expect(await manager.saveMemoryCandidatesFromTurns([
      { userMessage: 'Caldera contact is Nora.', assistantMessage: 'Noted.', sentAt: current.updatedAt - 1 },
      { userMessage: 'Thanks.', assistantMessage: 'Welcome.', sentAt: current.updatedAt - 1 }
    ])).toEqual([0, 0])
    expect(repository.getActiveMemoryItem(current.id)?.content).toBe(current.content)
  })

  it('retains independent temporary circumstances from every turn in a batch', async () => {
    const sentAt = Date.now() - 1_000
    state.prompt.mockResolvedValueOnce({ output: { items: [
      { turnIndex: 0, scope: 'temporary', content: 'Owner is visiting Lyon.', evidence: 'I am visiting Lyon.' },
      { turnIndex: 1, scope: 'temporary', content: 'Owner has a slow connection this week.', evidence: 'My connection is slow this week.' }
    ] } })
    expect(await manager.saveMemoryCandidatesFromTurns([
      { userMessage: 'I am visiting Lyon.', assistantMessage: 'Noted.', sentAt },
      { userMessage: 'My connection is slow this week.', assistantMessage: 'Noted.', sentAt }
    ])).toEqual([1, 1])
    expect(repository.listTemporaryItems(DEFAULT_TEMPORARY_MEMORY_POLICY.maxItems)).toHaveLength(2)
  })

  it('preserves unrelated project facts when applying an inferred correction', async () => {
    const caldera = await remember('Caldera invoices are fortnightly.')
    const borealis = await remember('Borealis invoices are fortnightly.')
    state.prompt.mockResolvedValueOnce({ output: { items: [{
      content: 'Caldera invoices are weekly.', evidence: 'Caldera invoices are weekly.',
      supersedesItemId: caldera.id
    }] } })
    expect(await manager.saveMemoryCandidatesFromTurn('Caldera invoices are weekly.', 'Noted.', Date.now())).toBe(1)
    expect(repository.getActiveMemoryItem(caldera.id)).toBeNull()
    expect(repository.getActiveMemoryItem(borealis.id)?.content).toBe(borealis.content)
  })

  it.each([
    { items: [{ content: 'Owner lives in Paris.', evidence: 'You live in Paris.' }] },
    { items: [{ content: 'Owner lives in Paris.' }] },
    '- Owner lives in Paris.',
    '{"items":[{"content":"Owner lives in Paris."',
    { items: [] }
  ])('ignores unsupported or malformed extraction output: %j', async (output) => {
    state.prompt.mockResolvedValue({ output })
    expect(await manager.saveMemoryCandidatesFromTurn('Thanks.', 'You live in Paris.', 1_000)).toBe(0)
    expect(repository.listPersistentMirrorRecords()).toEqual([])
  })

  it('upgrades an existing database automatically without losing chunks or fact provenance', async () => {
    const dbPath = path.join(state.root, 'legacy.sqlite')
    const old = new SQLite(dbPath)
    const schema = await fs.promises.readFile('server/src/core/memory-manager/sql/schema.sql', 'utf8')
    old.exec(schema.replace('\'discussion\', \'temporary\'', '\'discussion\''))
    old.exec(`
      INSERT INTO memory_items (id,scope,kind,content_md,content_text,source_type,created_at,updated_at)
      VALUES ('source','persistent','fact','Evidence','Evidence','explicit_user',1,1);
      INSERT INTO memory_chunks (id,item_id,namespace,chunk_index,content,created_at,updated_at)
      VALUES ('chunk','source','memory_persistent',0,'Evidence',1,1);
      INSERT INTO memory_facts (id,fact_key,fact_value_json,canonical_text,source_item_id,created_at,updated_at,last_seen_at)
      VALUES ('fact','test','true','Evidence','source',1,1,1);
    `)
    expect(() => upgradeMemoryScope(old, `${schema}\nSELECT missing_column FROM memory_items;`)).toThrow()
    expect(old.prepare('SELECT source_item_id FROM active_memory_facts').get()?.['source_item_id']).toBe('source')
    old.close()

    const upgraded = new MemoryRepository()
    await upgraded.load(dbPath)
    const db = (upgraded as unknown as { db: Database }).db
    try {
      expect(upgraded.getActiveMemoryItem('source')?.content).toBe('Evidence')
      expect(db.prepare('SELECT item_id FROM memory_chunks').get()?.['item_id']).toBe('source')
      expect(upgraded.getFactsTop(10)).toHaveLength(1)
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      const saved = upgraded.upsertMemoryItem({
        scope: 'temporary', kind: 'note', content: 'Current context', sourceType: 'explicit_user', expiresAt: Date.now() + 1_000
      }, 'temporary', Date.now(), () => 'temporary')
      expect(saved.scope).toBe('temporary')
    } finally {
      db.close()
    }
    // Reopening must be safe after a completed or interrupted setup retry.
    const reopened = new MemoryRepository()
    await reopened.load(dbPath)
    expect(reopened.getActiveMemoryItem('source')).not.toBeNull()
    ;(reopened as unknown as { db: Database }).db.close()
  })

  it('shares temporary context through SQLite without QMD and honors corrections, expiration and forgetting', async () => {
    const first = await remember('Je séjourne à Lyon.', {
      scope: 'temporary', metadata: { evidence: 'Je séjourne à Lyon.' }
    })
    expect((first.expiresAt as number) - first.createdAt).toBe(7 * 24 * 60 * 60 * 1_000)
    const otherSession = new MemoryManager()
    const otherRepository = new MemoryRepository()
    await otherRepository.load(path.join(state.root, 'memory.sqlite'))
    Object.assign(otherSession, { repository: otherRepository })
    try {
      expect((await otherSession.getTemporaryContext()).map((entry) => entry.content)).toEqual([first.content])
      const beforeRead = repository.getActiveMemoryItem(first.id)
      await otherSession.getTemporaryContext()
      expect(repository.getActiveMemoryItem(first.id)).toEqual(beforeRead)

      const corrected = await remember('我现在住在巴黎。', {
        scope: 'temporary', sourceRef: 'session:another:turn:2',
        supersedesItemId: first.id, metadata: { evidence: '我现在住在巴黎。' }
      })
      expect((await otherSession.getTemporaryContext()).map((entry) => entry.id)).toEqual([corrected.id])
      const db = (repository as unknown as { db: Database }).db
      db.prepare('UPDATE memory_items SET expires_at = ? WHERE id = ?').run(Date.now() - 1, corrected.id)
      expect(await otherSession.getTemporaryContext()).toEqual([])
      expect(await otherSession.getTemporaryContextSnapshot()).toEqual({ entries: [], hasMore: false })

      const active = await remember('我暂时只接受邮件。', {
        scope: 'temporary', metadata: { evidence: '我暂时只接受邮件。' }
      })
      await manager.forgetById(active.id)
      expect(await otherSession.getTemporaryContext()).toEqual([])
      expect(fs.existsSync(path.join(state.root, 'temporary'))).toBe(false)
    } finally {
      ;(otherRepository as unknown as { db: Database }).db.close()
    }
  })

  it('bounds temporary lifetime and prompt size without renewing repeated evidence', async () => {
    const record = await remember('Current constraint.', {
      scope: 'temporary', expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1_000,
      metadata: { evidence: 'Current constraint.' }
    })
    expect((record.expiresAt as number) - record.createdAt).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1_000)
    const retry = await remember(record.content, { scope: 'temporary', metadata: record.metadata })
    expect(retry.expiresAt).toBe(record.expiresAt)
    expect(retry.updatedAt).toBe(record.updatedAt)
    for (let index = 0; index < 15; index += 1) {
      await remember(`Contrainte temporaire ${index}.`, { scope: 'temporary', metadata: { evidence: `Contrainte ${index}.` } })
    }
    const snapshot = await manager.getTemporaryContext()
    expect(snapshot.length).toBeLessThanOrEqual(10)
    expect(getTemporaryContextSize(snapshot)).toBeLessThanOrEqual(DEFAULT_TEMPORARY_MEMORY_POLICY.tokenBudget)
    expect(await manager.getTemporaryContext()).toEqual(snapshot)
    expect(await manager.getTemporaryContextSnapshot()).toEqual({ entries: snapshot, hasMore: true })
    await expect(remember('Unverified', { scope: 'temporary' })).rejects.toThrow('evidence')
  })

  it('keeps explicit circumstances ahead of newer inferences under item and size limits', async () => {
    state.settings = { temporaryContext: { tokenBudget: 600 } }
    const location = await remember('I am staying in Lyon for a while.', {
      scope: 'temporary', metadata: { evidence: 'I am staying in Lyon for a while.' }
    })
    const db = (repository as unknown as { db: Database }).db
    db.prepare('UPDATE memory_items SET updated_at = ? WHERE id = ?').run(location.updatedAt - 1_000, location.id)

    for (let index = 0; index < 12; index += 1) {
      await remember(`The owner is considering a new post about topic ${index}.`, {
        scope: 'temporary', sourceType: 'inferred',
        metadata: { evidence: `Considering topic ${index}.` }
      })
    }

    expect(repository.listTemporaryItems(1).map((record) => record.id)).toEqual([location.id])
    const snapshot = await manager.getTemporaryContext()
    expect(snapshot[0]?.id).toBe(location.id)
    expect(getTemporaryContextSize(snapshot)).toBeLessThanOrEqual(600)
  })

  it('fits ten concise multilingual circumstances in the default context budget', async () => {
    const contents = [
      'I am staying in Lyon with my family until the end of the week.',
      ...Array.from({ length: 9 }, (_, index) => `这周我正在准备第 ${index + 1} 项活动，需要提前安排时间。`)
    ]
    const records = []

    for (const content of contents) {
      records.push(await remember(content, {
        scope: 'temporary', metadata: { evidence: content }
      }))
    }

    const snapshot = await manager.getTemporaryContext()
    expect(snapshot.map((entry) => entry.id).sort()).toEqual(records.map((record) => record.id).sort())
    expect(await manager.getTemporaryContextSnapshot()).toEqual({ entries: snapshot, hasMore: false })
    expect(Buffer.byteLength(JSON.stringify({
      temporary_context: snapshot, temporary_context_has_more: false
    }), 'utf8')).toBeLessThanOrEqual(DEFAULT_TEMPORARY_MEMORY_POLICY.tokenBudget)
    expect(getTemporaryContextSize(snapshot)).toBeLessThanOrEqual(DEFAULT_TEMPORARY_MEMORY_POLICY.tokenBudget)
  })

  it('extracts temporary circumstances with multilingual owner evidence in the existing background call', async () => {
    const evidence = '这周我住在株洲。'
    state.prompt.mockResolvedValueOnce({ output: { items: [{
      scope: 'temporary', content: evidence, evidence, expiresAt: null
    }] } })
    expect(await manager.saveMemoryCandidatesFromTurn(evidence, 'Noted.', Date.now())).toBe(1)
    expect(state.prompt).toHaveBeenCalledTimes(1)
    expect((await manager.getTemporaryContext()).map((entry) => entry.content)).toEqual([evidence])
    expect(repository.listPersistentMirrorRecords()).toEqual([])
  })

  it('uses fresh background evidence to correct or end an existing temporary situation', async () => {
    const first = await remember('Staying in Lyon.', {
      scope: 'temporary', metadata: { evidence: 'Staying in Lyon.' }
    })
    const correction = 'Je suis maintenant à Nantes.'
    state.prompt.mockResolvedValueOnce({ output: { items: [{
      scope: 'temporary', content: correction, evidence: correction, supersedesItemId: first.id
    }] } })
    expect(await manager.saveMemoryCandidatesFromTurn(correction, 'Noted.', Date.now() + 1_000)).toBe(1)
    expect(repository.getActiveMemoryItem(first.id)).toBeNull()
    const current = repository.listTemporaryItems(10)[0] as MemoryRecord
    expect(current.content).toBe(correction)

    const end = 'My stay is over.'
    state.prompt.mockResolvedValueOnce({ output: { items: [{
      scope: 'temporary', content: end, evidence: end, forgetItemId: current.id
    }] } })
    expect(await manager.saveMemoryCandidatesFromTurn(end, 'Noted.', Date.now() + 2_000)).toBe(1)
    expect(await manager.getTemporaryContext()).toEqual([])
    expect(repository.getActiveMemoryItem(first.id)).toBeNull()
  })
})
