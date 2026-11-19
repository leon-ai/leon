import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { create } from 'tar'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { setupRuntimeBinary } from '../../../scripts/setup/setup-runtime-binary'

let home: string
let root: string
let options: Parameters<typeof setupRuntimeBinary>[0]

beforeEach(async () => {
  vi.stubEnv('LEON_SETUP_PROGRESS', 'json')
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-runtime-setup-'))
  root = path.join(home, 'runtime')
  await fs.mkdir(root)
  await fs.writeFile(path.join(root, 'runtime'), 'working executable')
  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify({ version: '1.0.0' }))
  await fs.writeFile(path.join(root, 'versions.json'), 'retained version policy')
  options = {
    name: 'Runtime', version: '1.1.0', basePath: root, installPath: root,
    binaryPath: path.join(root, 'runtime'), manifestPath: path.join(root, 'manifest.json'),
    downloadURL: path.join(home, 'unavailable')
  }
})

afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true })
})

it('keeps the working executable and manifest when a replacement cannot be downloaded', async () => {
  await expect(setupRuntimeBinary(options)).rejects.toThrow()
  expect(await fs.readFile(options.binaryPath, 'utf8')).toBe('working executable')
  expect(JSON.parse(await fs.readFile(options.manifestPath, 'utf8')).version).toBe('1.0.0')
  expect(await fs.readdir(home)).toEqual(['runtime'])
})

it('rejects an incomplete archive without changing the installed runtime', async () => {
  const source = path.join(home, 'source')
  await fs.mkdir(source)
  await fs.writeFile(path.join(source, 'unrelated'), 'not an executable')
  const archive = path.join(home, 'runtime.tar.gz')
  await create({ file: archive, gzip: true, cwd: source }, ['unrelated'])
  await expect(setupRuntimeBinary({ ...options, downloadURL: archive, archiveFileName: 'runtime.tar.gz' })).rejects.toThrow()
  expect(await fs.readFile(options.binaryPath, 'utf8')).toBe('working executable')
  expect(JSON.parse(await fs.readFile(options.manifestPath, 'utf8')).version).toBe('1.0.0')
})

it.each([false, true])('activates a complete replacement and retains version policy (archive: %s)', async (archive) => {
  const source = path.join(home, 'source')
  await fs.mkdir(source)
  const executable = path.join(source, 'runtime')
  await fs.writeFile(executable, 'new executable')
  let downloadURL = executable
  if (archive) {
    downloadURL = path.join(home, 'runtime.tar.gz')
    await create({ file: downloadURL, gzip: true, cwd: home }, ['source'])
  }
  await setupRuntimeBinary({ ...options, downloadURL, ...(archive ? { archiveFileName: 'runtime.tar.gz' } : {}) })
  expect(await fs.readFile(options.binaryPath, 'utf8')).toBe('new executable')
  expect(JSON.parse(await fs.readFile(options.manifestPath, 'utf8')).version).toBe('1.1.0')
  expect(await fs.readFile(path.join(root, 'versions.json'), 'utf8')).toBe('retained version policy')
  expect((await fs.readdir(home)).some((name) => name.startsWith('.runtime-'))).toBe(false)
})
