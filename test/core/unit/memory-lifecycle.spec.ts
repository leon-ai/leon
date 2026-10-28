import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { Database } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MemoryManager from '@/core/memory-manager/memory-manager'
import MemoryRepository from '@/core/memory-manager/memory-repository'
import type { MemoryRecord, MemoryWriteInput } from '@/core/memory-manager/types'

const state = vi.hoisted(() => ({
  root: '',
  rows: [] as Array<Record<string, unknown>>,
  prompt: vi.fn()
}))

vi.mock('@/constants', () => ({ CODEBASE_PATH: process.cwd() }))
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

})
