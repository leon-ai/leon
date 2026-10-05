import { ToolConcurrency } from '@/types'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'

import { ToolWorkerManager } from '@/core/tool-manager/tool-worker-manager'
import type { ToolRuntimeResult } from '@sdk/tool-runtime-types'
import { runRipgrep } from '@@/tools/operating_system_control/ripgrep/src/nodejs/lib/run-ripgrep'

const LARGE_RESULT_BYTES = 4 * 1_024 * 1_024

it.each(['recordLimit', 'timeout', 'canceled'])(
  'preserves the %s guard while awaiting an asynchronous ripgrep sink',
  async (reason) => {
    const controller = new AbortController()
    const program = reason === 'timeout'
      ? 'setInterval(() => {}, 1000)'
      : 'process.stdout.write(Buffer.from([97, 0, 98, 0]))'
    const consume = vi.fn(async () => {
      if (reason === 'canceled') {
        controller.abort()
        return true
      }

      return false
    })
    expect(await runRipgrep(
      process.execPath, ['-e', program], reason === 'timeout' ? 100 : 5_000,
      0, consume, controller.signal
    )).toEqual({ truncated: true, reason })
    expect(consume).toHaveBeenCalledTimes(reason === 'timeout' ? 0 : 1)
  }
)

let home = ''
let manager: ToolWorkerManager

it('isolates concurrent calls even when a tool normally retains instance state', async () => {
  await fixture(true)
  const run = (session: string): Promise<ToolRuntimeResult> => manager.execute({
    toolkitId: 'fixture', toolId: 'state', functionName: 'next',
    profileName: 'a', conversationSessionId: session, parameters: {}
  }, [false, false], () => {}, { concurrency: ToolConcurrency.Parallel })
  const [first, second] = await Promise.all([run('one'), run('two')])

  expect(first.output['result']).toMatchObject({ count: 1, session: 'one' })
  expect(second.output['result']).toMatchObject({ count: 1, session: 'two' })
  expect((first.output['result'] as { pid: number }).pid)
    .not.toBe((second.output['result'] as { pid: number }).pid)
  expect((await fs.readFile(path.join(home, 'disposed'), 'utf8')).trim().split('\n'))
    .toEqual(['a', 'a'])
})

it('delivers a large result before retiring a one-shot worker', async () => {
  await fixture(false)

  const result = await manager.execute({
    toolkitId: 'fixture',
    toolId: 'state',
    functionName: 'largeResult',
    profileName: 'a',
    conversationSessionId: 'large-result',
    parameters: {}
  }, [LARGE_RESULT_BYTES], () => {})

  expect(result.success, result.message).toBe(true)
  expect(result.output['result']).toEqual({ payload: 'x'.repeat(LARGE_RESULT_BYTES) })
  expect(await fs.readFile(path.join(home, 'disposed'), 'utf8')).toBe('a\n')
})

it('runs two workers at once and cancellation affects only the selected call', async () => {
  await fixture(true)
  const firstController = new AbortController()
  const secondController = new AbortController()
  let started = 0
  let releaseBothStarted: () => void = () => {}
  const bothStarted = new Promise<void>((resolve) => {
    releaseBothStarted = resolve
  })
  const run = (profile: string, controller: AbortController): Promise<ToolRuntimeResult> => manager.execute({
    toolkitId: 'fixture', toolId: 'state', functionName: 'hold',
    profileName: profile, conversationSessionId: 'one', parameters: {},
    signal: controller.signal
  }, [], (line) => {
    if (line.includes('fixture-waiting')) {
      started += 1
      if (started === 2) {
        releaseBothStarted()
      }
    }
  }, { concurrency: ToolConcurrency.Parallel })
  const first = run('a', firstController)
  const second = run('b', secondController)
  await bothStarted
  firstController.abort()
  expect((await first).success).toBe(false)
  expect(secondController.signal.aborted).toBe(false)
  expect(await fs.readFile(path.join(home, 'disposed'), 'utf8')).toBe('a\n')
  secondController.abort()
  expect((await second).success).toBe(false)
}, 10_000)

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
import { spawnSync } from 'node:child_process'
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
  largeResult(bytes) {
    return { payload: 'x'.repeat(bytes) }
  }
  async readInput() {
    const command = [
      "process.stdin.on('end', () => {",
      "  process.stdout.write('stdin-closed')",
      '})',
      'process.stdin.resume()'
    ].join('\\n')

    return this.executeCommand({
      binaryName: process.execPath,
      args: ['-e', command],
      options: { timeout: 5_000 },
      skipBinaryDownload: true
    })
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
    profileName: profile, conversationSessionId: session, parameters: {} }, [attach, crash], () => {}, { concurrency: ToolConcurrency.Serial })
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

it('closes unused stdin so non-interactive commands can finish', async () => {
  await fixture(false)

  const result = await manager.execute({
    toolkitId: 'fixture',
    toolId: 'state',
    functionName: 'readInput',
    profileName: 'a',
    conversationSessionId: 'one',
    parameters: {}
  }, [], () => {})

  expect(result.success).toBe(true)
  expect(result.output['result']).toBe('stdin-closed')
})

it('cancels an active call cooperatively and releases its worker before another call', async () => {
  await fixture(true)
  const controller = new AbortController()
  const result = await manager.execute({ toolkitId: 'fixture', toolId: 'state', functionName: 'hold',
    profileName: 'a', conversationSessionId: 'one', parameters: {}, signal: controller.signal }, [],
  (line) => { if (line.includes('fixture-waiting')) controller.abort() }, { concurrency: ToolConcurrency.Serial })
  expect(result.success).toBe(false)
  expect(result.message).toContain('canceled')
  expect(await fs.readFile(path.join(home, 'disposed'), 'utf8')).toBe('a\n')
  expect((await next('a', 'two')).output['result']).toMatchObject({ count: 1 })
})


it.skipIf(spawnSync('rg', ['--version']).status !== 0)('executes built-in ripgrep functions through real profile workers', async () => {
  await fixture(false)
  const { default: ToolkitRegistry } = await import('@/core/tool-manager/toolkit-registry')
  const registry = new ToolkitRegistry()
  await registry.load()
  expect(registry.getFlattenedTools()).toContainEqual(expect.objectContaining({ toolkitId: 'operating_system_control', toolId: 'ripgrep' }))
  expect(Object.keys(registry.getToolFunctions('operating_system_control', 'ripgrep') || {})).toEqual(['search', 'listFiles'])
  const source = path.join(home, 'sample.ts')
  await fs.writeFile(source, 'first\nneedle\n')
  const context = { toolkitId: 'operating_system_control', toolId: 'ripgrep',
    profileName: 'a', conversationSessionId: 'ripgrep', parameters: {} }
  // A cold install from two workers must publish an executable atomically.
  const [search, files] = await Promise.all([
    manager.execute({ ...context, functionName: 'search' },
      ['needle', [source]], () => {}, { concurrency: ToolConcurrency.Parallel }),
    manager.execute({ ...context, functionName: 'listFiles' },
      [[source]], () => {}, { concurrency: ToolConcurrency.Parallel })
  ])
  expect(search.success, search.message).toBe(true)
  expect(search.output['result']).toMatchObject({ truncated: false, matches: [
    { path: { text: source }, line_number: 2, lines: { text: 'needle\n' } }
  ] })
  expect(files.success, files.message).toBe(true)
  expect(files.output['result']).toMatchObject({ truncated: false, files: [{ text: source }] })

  // Long paths exceed the former 4 MiB cap with a modest number of empty files.
  const directory = path.join(home, ...Array.from({ length: 4 }, () => 'd'.repeat(240)))
  await fs.mkdir(directory, { recursive: true })
  const inventory = Array.from({ length: 4_001 }, (_, index) =>
    path.join(directory, `${'f'.repeat(210)}-${index}.png`)
  )
  for (let offset = 0; offset < inventory.length; offset += 64) {
    await Promise.all(inventory.slice(offset, offset + 64).map((filename) => fs.writeFile(filename, '')))
  }
  const listing = await manager.execute({ ...context, functionName: 'listFiles' },
    [[directory]], () => {}, { concurrency: ToolConcurrency.Parallel })
  expect(listing.success, listing.message).toBe(true)
  const saved = listing.output['result'] as {
    files: { text: string }[]
    retainedOutput: { path: string }
  }
  expect(saved.files.length).toBeLessThan(100)
  expect(listing.output['result']).toMatchObject({
    truncated: false,
    summary: { returnedRecords: inventory.length, complete: true },
    preview: { truncated: true }
  })
  expect(JSON.stringify(listing).length).toBeLessThan(40_000)
  expect((await fs.stat(saved.retainedOutput.path)).size).toBeGreaterThan(LARGE_RESULT_BYTES)
  const complete = JSON.parse(await fs.readFile(saved.retainedOutput.path, 'utf8'))
  expect(complete.result.files.map((file: { text: string }) => file.text).sort()).toEqual(inventory.sort())
})
