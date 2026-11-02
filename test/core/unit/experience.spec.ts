import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ExperienceManager from '@/core/experience-manager'
import { runInference } from '@/core/llm-manager/inference'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'

const fixture = vi.hoisted(() => ({ root: '', maximum: 3 }))

vi.mock('@/config', () => ({
  CONFIG_MANAGER: { getConfig: (): unknown => ({ runtime: {} }) }
}))
vi.mock('@/constants', () => ({
  CODEBASE_PATH: process.cwd(),
  get MAXIMUM_EXPERIENCES(): number {
    return fixture.maximum
  }
}))
vi.mock('@/helpers/log-helper', () => ({
  LogHelper: { title: vi.fn(), info: vi.fn(), debug: vi.fn(), warning: vi.fn(), error: vi.fn() }
}))
vi.mock('@/core/llm-manager/inference', () => ({ runInference: vi.fn() }))
vi.mock('@/core/profile-runtime/profile-paths', () => ({
  getProfilePaths: (): unknown => ({ agentSkills: path.join(fixture.root, 'skills', 'agent') })
}))

describe('experience retention and adoption', () => {
  let manager: ExperienceManager

  beforeEach(() => {
    fixture.root = fs.mkdtempSync(path.join(os.tmpdir(), 'leon-experience-'))
    fixture.maximum = 3
    manager = new ExperienceManager()
  })

  afterEach(() => {
    manager.close()
    fs.rmSync(fixture.root, { recursive: true, force: true })
  })

  function save(name: string, workspaceOnly = false): NonNullable<ReturnType<ExperienceManager['save']>> {
    const saved = manager.save({
      name, description: `Recover ${name} after a descriptor failure.`,
      instructions: `Check the descriptor, refresh it, then verify ${name}.`, workspaceOnly
    }, 'session:fixture', ['fixture.recovery.run'], '/workspace/a')
    expect(saved).not.toBeNull()
    return saved!
  }

  it('counts activation separately from tool-backed use and persists both across reloads', () => {
    const record = save('descriptor-recovery')
    manager.getContext()
    manager.search('descriptor')
    expect(manager.list()[0]).toMatchObject({ loadCount: 0, useCount: 0, lastUsedAt: null })

    manager.load(record.id, 'task-a')
    manager.load(record.id, 'task-a')
    manager.recordUse(record.id, 'task-a', 'unrelated.lookup')
    expect(manager.list()[0]).toMatchObject({ loadCount: 1, useCount: 0 })
    manager.recordUse(record.id, 'task-a', 'fixture.recovery.run')
    manager.recordUse(record.id, 'task-a', 'fixture.recovery.run')
    manager.releaseTask('task-a')
    manager.close()
    expect(manager.list()[0]).toMatchObject({ loadCount: 1, useCount: 1 })
    expect(manager.list()[0]!.lastUsedAt).toEqual(expect.any(Number))
  })

  it('evicts by last application or creation while updates and loads do not renew retention', () => {
    const time = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const first = save('first-recovery')
    time.mockReturnValue(2_000)
    const second = save('second-recovery')
    time.mockReturnValue(3_000)
    save('third-recovery')
    time.mockReturnValue(4_000)
    manager.load(first.id, 'task')
    manager.recordUse(first.id, 'task', 'fixture.recovery.run')
    manager.releaseTask('task')
    manager.save({ ...second, instructions: 'A more complete recovery procedure.' }, 'session:update', [])
    manager.load(second.id, 'inspection')
    manager.releaseTask('inspection')
    save('fourth-recovery')
    expect(manager.list().map((record) => record.name)).toEqual(expect.arrayContaining([
      'first-recovery', 'third-recovery', 'fourth-recovery'
    ]))
    expect(manager.list().some((record) => record.id === second.id)).toBe(false)
  })

  it('protects active guidance and never retires owner-installed skill files', () => {
    fixture.maximum = 1
    const owner = path.join(fixture.root, 'skills', 'agent', 'owner-skill', 'SKILL.md')
    fs.mkdirSync(path.dirname(owner), { recursive: true })
    fs.writeFileSync(owner, 'Owner guidance')
    const record = save('active-recovery')
    manager.load(record.id, 'active-task')
    expect(manager.save({ name: 'new-recovery', description: 'Recovery', instructions: 'Verify the connection.' }, 'session:new', [])).toBeNull()
    manager.releaseTask('active-task')
    save('new-recovery')
    expect(fs.readFileSync(owner, 'utf8')).toBe('Owner guidance')
    expect(fs.existsSync(path.join(fixture.root, 'skills', 'agent', 'experiences', record.id.split(':')[1]!, 'SKILL.md'))).toBe(false)
  })

  it('bounds active procedure bytes and count independently of archive capacity', () => {
    const records = ['first', 'second', 'third'].map((name) => manager.save({
      name, description: 'Inspect a service.', instructions: 'Inspect status. '.repeat(40)
    }, 'session:fixture', ['fixture.inspect'])!)
    expect(manager.load(records[0]!.id, 'task')).not.toBeNull()
    expect(manager.load(records[1]!.id, 'task')).not.toBeNull()
    expect(manager.load(records[2]!.id, 'task')).toBeNull()
    manager.releaseTask('task')

    manager.save({ ...records[1]!, instructions: 'Inspect status. '.repeat(70) }, 'session:update', [])
    expect(manager.load(records[0]!.id, 'large-task')).not.toBeNull()
    expect(manager.load(records[1]!.id, 'large-task')).toBeNull()
    expect(manager.list().find((record) => record.id === records[1]!.id)!.loadCount).toBe(1)
  })

  it('bounds discovery independently of archive size and respects workspace applicability', () => {
    fixture.maximum = 196
    const scoped = save('workspace-recovery', true)
    expect(manager.load(scoped.id, 'wrong-workspace', '/workspace/b')).toBeNull()
    expect(manager.load(scoped.id, 'right-workspace', '/workspace/a')).not.toBeNull()
    manager.releaseTask('right-workspace')
    for (let index = 0; index < 196; index += 1) {
      save(`descriptor-${index}`)
    }
    const cards = manager.getContext('/workspace/b')
    expect(manager.list()).toHaveLength(196)
    expect(cards.length).toBeLessThanOrEqual(3)
    expect(Buffer.byteLength(JSON.stringify(cards))).toBeLessThanOrEqual(500)
    expect(manager.load(scoped.id, 'wrong-workspace', '/workspace/b')).toBeNull()
    expect(manager.search('completely-unrelated-subject')).toEqual([])
  })

  it('surfaces older task-relevant guidance without an inference or archive-sized context', () => {
    fixture.maximum = 196
    const recovery = save('exporter-recovery')
    for (let index = 0; index < 195; index += 1) {
      manager.save({
        name: `botanical-catalog-${index}`, description: 'Organize botanical specimens.',
        instructions: 'Sort specimen accession numbers and verify labels.'
      }, 'session:catalog', [])
    }
    const cards = manager.getContext('/workspace/a', 'The exporter is stuck again.')
    expect(cards.map((card) => card.id)).toContain(recovery.id)
    expect(Buffer.byteLength(JSON.stringify(cards))).toBeLessThanOrEqual(500)
    expect(runInference).not.toHaveBeenCalled()
  })

  it('recognizes the same workspace through a directory symlink', () => {
    const workspace = path.join(fixture.root, 'workspace')
    const alias = path.join(fixture.root, 'workspace-alias')
    fs.mkdirSync(workspace)
    fs.symlinkSync(workspace, alias, 'junction')
    const record = manager.save({
      name: 'scoped-recovery', description: 'Recover the report exporter.',
      instructions: 'Inspect status, refresh the descriptor, and verify recovery.', workspaceOnly: true
    }, 'session:fixture', ['fixture.recovery.run'], alias)!
    expect(manager.getContext(workspace, 'Recover the report exporter.').map((card) => card.id))
      .toContain(record.id)
    expect(manager.load(record.id, 'task', workspace)).not.toBeNull()
  })

  it('captures a supported procedure from structured inference output and actual tool result evidence', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
    vi.spyOn(SkillDomainHelper, 'getAgentSkillCatalogContentSync').mockReturnValue('')
    vi.mocked(runInference).mockResolvedValue({
      // Structured provider duties may return the decoded object rather than text.
      output: { experience: {
        name: 'service-recovery', description: 'Recover a stopped service with a stale descriptor.',
        instructions: 'Inspect status, refresh the stale descriptor, resume, and verify status.', workspaceOnly: true
      } } as unknown as string,
      usedInputTokens: 1, usedOutputTokens: 1
    })
    const onActivity = vi.fn()
    const input: Parameters<ExperienceManager['observeTurn']>[0] = {
      onActivity,
      query: 'Restore the stopped service.', output: 'Status confirms the service is serving jobs.',
      sourceRef: 'session:verified', workspace: '/workspace/a',
      executions: ['refresh', 'verify'].map((operation) => ({
        function: 'fixture.service.run', status: 'success',
        requestedToolInput: JSON.stringify({ operation }),
        observation: JSON.stringify({ status: 'success', data: {
          output: { serving: operation === 'verify' }
        } })
      }))
    }
    const outcome = await manager.observeTurn(input)
    expect(outcome.outcome).toBe('completed')
    expect(onActivity).toHaveBeenCalledOnce()
    expect(onActivity.mock.calls[0]?.[0].memory.durationMs).toBeGreaterThan(0)
    expect(onActivity.mock.calls[0]?.[0]).toMatchObject({
      content: 'Learned an experience', iconName: 'brain-2-line',
      memory: { action: 'experience_learned' }
    })
    expect(manager.list()[0]).toMatchObject({ workspace: '/workspace/a', loadCount: 0, useCount: 0 })
    expect(JSON.parse(vi.mocked(runInference).mock.calls[0]![0].prompt).evidence[1].observation)
      .toContain('"serving":true')

    expect((await manager.observeTurn(input)).outcome).toBe('skipped')
    expect(onActivity).toHaveBeenCalledOnce()
    const record = manager.list()[0]!
    vi.mocked(runInference).mockResolvedValueOnce({
      output: JSON.stringify({ experience: {
        id: record.id, name: record.name, description: record.description,
        instructions: `${record.instructions} Retain the verified status.`, workspaceOnly: true
      } }), usedInputTokens: 1, usedOutputTokens: 1
    })
    expect((await manager.observeTurn(input)).outcome).toBe('completed')
    expect(onActivity).toHaveBeenCalledTimes(2)
    expect(onActivity.mock.calls[1]?.[0]).toMatchObject({
      content: 'Updated an experience', memory: { action: 'experience_updated' }
    })
  })

  it('keeps independently owned profile archives isolated', () => {
    save('private-recovery')
    const originalRoot = fixture.root
    fixture.root = path.join(originalRoot, 'other-profile')
    const other = new ExperienceManager()
    try {
      expect(other.list()).toEqual([])
      expect(other.search('private recovery')).toEqual([])
    } finally {
      other.close()
      fixture.root = originalRoot
    }
  })
})
