import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

import { ToolWorkerManager } from '@/core/tool-worker-manager'
import type { ToolRuntimeResult } from '@sdk/tool-runtime-types'

let home = ''
let manager: ToolWorkerManager

afterEach(async () => {
  await manager?.dispose()
  if (home) await fs.rm(home, { recursive: true, force: true })
})

/**
 * Exercise real bridge processes with a harmless profile tool, never the owner's desktop.
 */
async function fixture(persistent: boolean): Promise<void> {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-worker-'))
  vi.stubEnv('LEON_HOME', home)
  manager = new ToolWorkerManager()
  for (const profile of ['a', 'b']) {
    const directory = path.join(home, 'profiles', profile, 'tools', 'fixture', 'state')
    await fs.mkdir(path.join(directory, 'src', 'nodejs'), { recursive: true })
    await fs.writeFile(path.join(directory, 'tool.json'), '{}')
    await fs.writeFile(path.join(directory, 'src', 'nodejs', 'index.ts'), `
import fs from 'node:fs/promises'
import path from 'node:path'
import { Tool } from '@sdk/base-tool'
import { ToolRuntimeLifetime } from '@bridge/tool-runtime-types'
export default class Fixture extends Tool {
  toolName = 'state'; toolkit = 'fixture'; description = 'Worker fixture'
  runtimeLifetime = ToolRuntimeLifetime.${persistent ? 'Persistent' : 'Call'}
  count = 0
  async next(attach, crash = false) {
    if (crash) process.exit(7)
    this.count++
    if (attach) this.attachModelFiles([{ dataBase64: 'eA==', mediaType: 'text/plain' }])
    return { count: this.count, profile: this.executionContext.profileName,
      session: this.executionContext.conversationSessionId, pid: process.pid }
  }
  async hold() {
    this.log('fixture-waiting')
    await new Promise((resolve) => this.executionContext.signal.addEventListener('abort', resolve, { once: true }))
    return { interrupted: true }
  }
  async dispose() {
    await fs.appendFile(path.join(process.env.LEON_HOME, 'disposed'), process.env.LEON_PROFILE + '\\n')
  }
}
`)
  }
}

async function next(profile: string, session: string, attach = false, crash = false): Promise<ToolRuntimeResult> {
  return manager.execute({ toolkitId: 'fixture', toolId: 'state', functionName: 'next',
    profileName: profile, conversationSessionId: session, parameters: {} }, [attach, crash], () => {})
}

it('retains per-profile state, refreshes session context, clears attachments and disposes workers', async () => {
  await fixture(true)
  const first = await next('a', 'one', true)
  expect(first.success).toBe(true)
  expect(first.modelFiles).toHaveLength(1)
  const second = await next('a', 'two')
  expect(second.output['result']).toMatchObject({ count: 2, profile: 'a', session: 'two' })
  expect(second.modelFiles).toBeUndefined()
  expect((await next('b', 'three')).output['result']).toMatchObject({ count: 1, profile: 'b' })
  await manager.dispose()
  expect((await fs.readFile(path.join(home, 'disposed'), 'utf8')).trim().split('\n').sort()).toEqual(['a', 'b'])
})

it('keeps ordinary calls isolated and does not replay a crashed persistent call', async () => {
  await fixture(false)
  expect((await next('a', 'one')).output['result']).toMatchObject({ count: 1 })
  expect((await next('a', 'one')).output['result']).toMatchObject({ count: 1 })
  await manager.dispose()
  await fs.rm(home, { recursive: true, force: true })
  await fixture(true)
  expect((await next('a', 'one')).success).toBe(true)
  const crashed = await next('a', 'one', false, true)
  expect(crashed.success).toBe(false)
  expect(crashed.message).toContain('Input may have been delivered')
  expect((await next('a', 'one')).output['result']).toMatchObject({ count: 1 })
})

it('cancels an active call cooperatively and releases its worker before another call', async () => {
  await fixture(true)
  const controller = new AbortController()
  const result = await manager.execute({ toolkitId: 'fixture', toolId: 'state', functionName: 'hold',
    profileName: 'a', conversationSessionId: 'one', parameters: {}, signal: controller.signal }, [],
  (line) => { if (line.includes('fixture-waiting')) controller.abort() })
  expect(result.success).toBe(false)
  expect(result.message).toContain('canceled')
  expect(await fs.readFile(path.join(home, 'disposed'), 'utf8')).toBe('a\n')
  expect((await next('a', 'two')).output['result']).toMatchObject({ count: 1 })
})
