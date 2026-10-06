import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'

import { ToolConcurrency } from '@/types'
import { ToolWorkerManager } from '@/core/tool-manager/tool-worker-manager'
import type { ToolRuntimeResult } from '@sdk/tool-runtime-types'

let directory = ''
let manager: ToolWorkerManager

afterEach(async () => {
  await manager?.dispose()
  if (directory) {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

async function fixture(): Promise<void> {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-shell-'))
  manager = new ToolWorkerManager()
  await fs.writeFile(path.join(directory, 'prompt.cjs'), [
    'process.stdout.write(\'ready\\n\')',
    'process.stdin.setEncoding(\'utf8\')',
    'process.stdin.on(\'data\', (data) => {',
    '  process.stdout.write(\'answer:\' + data)',
    '  if (data.includes(\'quit\')) process.exit(7)',
    '})'
  ].join('\n'))
}

async function call(
  functionName: string,
  args: unknown[],
  conversation = 'owner',
  options: { signal?: AbortSignal, profile?: string } = {}
): Promise<Record<string, unknown>> {
  const result: ToolRuntimeResult = await manager.execute({
    toolkitId: 'operating_system_control',
    toolId: 'shell',
    functionName,
    profileName: options.profile || 'default',
    conversationSessionId: conversation,
    parameters: {},
    ...(options.signal ? { signal: options.signal } : {})
  }, args, () => {}, {
    concurrency: functionName === 'executeCommand' ? ToolConcurrency.Parallel : ToolConcurrency.Serial
  })
  expect(result.success, result.message).toBe(true)
  return result.output['result'] as Record<string, unknown>
}

function data(result: Record<string, unknown>): Record<string, unknown> {
  expect(result['success'], String(result['error'])).toBe(true)
  return result['data'] as Record<string, unknown>
}

it.each([false, true])('retains stdin and output with pty=%s, isolates owners and reports exit failure', async (pty) => {
  await fixture()
  const started = data(await call('startSession', ['node prompt.cjs', { cwd: directory, pty }]))
  const id = started['sessionId']
  expect(started['running']).toBe(true)
  expect((await call('readSession', [id], 'another'))['success']).toBe(false)
  expect((await call('readSession', [id], 'owner', { profile: 'other' }))['success']).toBe(false)
  await expect.poll(async () => String(data(await call('readSession', [id]))['output']))
    .toContain('ready')

  await call('writeSession', [id, 'hello\n'])
  await expect.poll(async () => String(data(await call('readSession', [id]))['output']))
    .toContain('answer:hello')
  await call('writeSession', [id, 'quit\n'])
  await expect.poll(async () => data(await call('readSession', [id]))['running']).toBe(false)
  const ended = data(await call('readSession', [id]))
  expect(ended).toMatchObject({ exitCode: 7, commandSucceeded: false })
  expect(data(await call('readSession', [id, { offsetChars: ended['nextOffsetChars'] }]))['output']).toBe('')
})

it('keeps finite calls independent of sessions and cleans up descendants on stop and worker shutdown', async () => {
  await fixture()
  await fs.writeFile(path.join(directory, 'tree.cjs'), [
    'const { spawn } = require(\'node:child_process\')',
    'const child = spawn(process.execPath, [\'-e\', \'setInterval(() => {}, 1000)\'])',
    'process.stdout.write(\'child:\' + child.pid + \'\\n\')',
    'setInterval(() => {}, 1000)'
  ].join('\n'))
  const started = data(await call('startSession', ['node tree.cjs', { cwd: directory }]))
  const id = started['sessionId']
  let output = ''
  await expect.poll(async () => {
    output = String(data(await call('readSession', [id]))['output'])
    return output
  }).toContain('child:')
  const childPid = Number(output.trim().split(':').at(-1))

  const finite = await call('executeCommand', ['node -e "process.stdout.write(\'finite\')"', { cwd: directory }])
  expect(finite).toMatchObject({ success: true, stdout: 'finite' })
  expect(data(await call('readSession', [id]))['running']).toBe(true)

  const controller = new AbortController()
  const finitePidPath = path.join(directory, 'finite.pid')
  await fs.writeFile(path.join(directory, 'finite.cjs'), [
    'require(\'node:fs\').writeFileSync(\'finite.pid\', String(process.pid))',
    'setInterval(() => {}, 1000)'
  ].join('\n'))
  const pending = manager.execute({
    toolkitId: 'operating_system_control',
    toolId: 'shell',
    functionName: 'executeCommand',
    profileName: 'default',
    conversationSessionId: 'owner',
    parameters: {},
    signal: controller.signal
  }, ['node finite.cjs', { cwd: directory }], () => {}, {
    concurrency: ToolConcurrency.Parallel
  })

  await expect.poll(() => fs.stat(finitePidPath).then(() => true, () => false)).toBe(true)
  const finitePid = Number(await fs.readFile(finitePidPath, 'utf8'))

  // A finite call must not occupy the session worker or cancel its process tree.
  expect(data(await call('readSession', [id]))['running']).toBe(true)
  controller.abort()
  expect((await pending).success).toBe(false)
  await expect.poll(() => processAlive(finitePid)).toBe(false)
  expect(data(await call('readSession', [id]))['running']).toBe(true)

  expect(data(await call('stopSession', [id]))).toMatchObject({ running: false, status: 'stopped' })
  await expect.poll(() => processAlive(childPid)).toBe(false)

  const second = data(await call('startSession', ['node tree.cjs', { cwd: directory }]))
  const pid = Number(second['pid'])
  await manager.dispose()
  await expect.poll(() => processAlive(pid)).toBe(false)
})

it('retains timeout results and bounds output with continuation cursors', async () => {
  await fixture()
  await fs.writeFile(path.join(directory, 'output.cjs'), [
    'process.stdout.write(\'x\'.repeat(300000))',
    'setInterval(() => {}, 1000)'
  ].join('\n'))
  const started = data(await call('startSession', ['node output.cjs', { cwd: directory, timeoutMs: 1_000 }]))
  const id = started['sessionId']
  await expect.poll(async () => data(await call('readSession', [id]))['running'], { timeout: 5_000 }).toBe(false)
  const page = data(await call('readSession', [id, { maxChars: 100 }]))
  expect(page).toMatchObject({ status: 'timed_out', outputLost: true, hasMore: true, commandSucceeded: false })
  expect(String(page['output']).length).toBe(100)
  const next = data(await call('readSession', [id, { offsetChars: page['nextOffsetChars'], maxChars: 100 }]))
  expect(next['offsetChars']).toBe(page['nextOffsetChars'])
})

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
