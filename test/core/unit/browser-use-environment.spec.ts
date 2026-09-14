import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'

import { afterEach, expect, it, vi } from 'vitest'

import { describeBrowserUseReadinessFailure, prepareBrowserUseEnvironment } from '@@/tools/browser_use/src/nodejs/lib/browser-use-environment'

const directories = new Set<string>()

async function createProfile(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-browser-test-'))
  directories.add(root)
  const directory = path.join(root, 'a-long-profile-name-'.repeat(8), 'tools', 'browser_use', 'cli')
  await fs.mkdir(directory, { recursive: true })
  return path.join(directory, 'settings.json')
}

async function environment(settingsPath: string): Promise<NodeJS.ProcessEnv> {
  const result = await prepareBrowserUseEnvironment(settingsPath)
  directories.add(result['BH_RUNTIME_DIR']!)
  return result
}

afterEach(async () => {
  vi.restoreAllMocks()
  for (const directory of directories) await fs.rm(directory, { recursive: true, force: true })
  directories.clear()
})

it('uses stable private IPC per profile without shortening artifact or log paths', async () => {
  const settings = await createProfile()
  const first = await environment(settings)
  expect(await environment(settings)).toEqual(first)
  expect((await environment(await createProfile()))['BH_RUNTIME_DIR']).not.toBe(first['BH_RUNTIME_DIR'])
  expect(first['BH_HOME']).toBe(path.join(await fs.realpath(path.dirname(settings)), 'runtime'))
  expect(first['BH_TMP_DIR']).toBe(path.join(first['BH_HOME']!, 'tmp'))
  if (process.platform !== 'win32') {
    expect((await fs.stat(first['BH_RUNTIME_DIR']!)).mode & 0o077).toBe(0)
    expect(Buffer.byteLength(path.join(first['BH_RUNTIME_DIR']!, 'bu.sock'))).toBeLessThanOrEqual(103)
  }
})

it.skipIf(process.platform === 'win32')('binds a real socket even when TMPDIR and profile paths are long', async () => {
  const settings = await createProfile()
  vi.spyOn(os, 'tmpdir').mockReturnValue(path.dirname(settings))
  const env = await environment(settings)
  const server = net.createServer()
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(path.join(env['BH_RUNTIME_DIR']!, 'bu.sock'), resolve)
    })
    expect(server.listening).toBe(true)
  } finally {
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

it.skipIf(process.platform === 'win32')('refuses a shared directory or symlink instead of repairing it', async () => {
  const settings = await createProfile()
  const env = await environment(settings)
  const runtime = env['BH_RUNTIME_DIR']!
  await fs.chmod(runtime, 0o755)
  await expect(prepareBrowserUseEnvironment(settings)).rejects.toThrow('not private')
  await fs.rmdir(runtime)
  await fs.symlink(path.dirname(settings), runtime)
  await expect(prepareBrowserUseEnvironment(settings)).rejects.toThrow('not private')
})

it.each(['permission-blocked:', 'remote-debugging-setup:'])('preserves upstream authorization handoff %s', (code) => {
  const failure = describeBrowserUseReadinessFailure({ stdout: '', stderr: `RuntimeError: ${code} approval needed`, exitCode: 1, timedOut: false }, '/profile/bu.log')
  expect(failure.requiresOwnerAction).toBe(true)
})

it.each([
  { stderr: 'fatal: AF_UNIX path too long', timedOut: false },
  { stderr: 'PermissionError: local directory is not writable', timedOut: false },
  { stderr: '', timedOut: true }
])('does not present local CLI failures as browser consent failures: $stderr', ({ stderr, timedOut }) => {
  const failure = describeBrowserUseReadinessFailure({ stdout: '', stderr, exitCode: 1, timedOut }, '/profile/bu.log')
  expect(failure.requiresOwnerAction).toBe(false)
  expect(failure.message).toContain(stderr)
  expect(failure.message).toContain('/profile/bu.log')
})
