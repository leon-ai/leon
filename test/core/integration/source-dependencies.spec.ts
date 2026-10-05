import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import { afterEach, expect, it, vi } from 'vitest'
import YAML from 'yaml'

import { syncNodejsSourceDependencies } from '@@/scripts/setup/sync-source-dependencies'

const fixture = vi.hoisted(() => ({ codebase: '' }))

vi.mock('@/constants', async (importOriginal) => {
  const constants = await importOriginal<typeof import('@/constants')>()

  return {
    ...constants,
    get CODEBASE_PATH(): string {
      return fixture.codebase
    }
  }
})

let directory = ''

afterEach(async () => {
  if (directory) {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

it('inherits root build permissions for standalone profile sources and invalidates sync when they change', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-source-dependencies-'))
  fixture.codebase = path.join(directory, 'codebase')
  const source = path.join(directory, 'profile', 'shell', 'src', 'nodejs')
  const workspace = path.join(fixture.codebase, 'pnpm-workspace.yaml')
  const stamp = path.join(source, '.last-source-deps-sync')
  const manifest = await fs.readFile(
    path.resolve('tools/operating_system_control/shell/src/nodejs/package.json'),
    'utf8'
  )

  await fs.mkdir(fixture.codebase, { recursive: true })
  await fs.mkdir(source, { recursive: true })
  await fs.writeFile(path.join(source, 'package.json'), manifest)
  await fs.writeFile(workspace, YAML.stringify({
    dangerouslyAllowAllBuilds: true,
    sideEffectsCache: false
  }))

  await syncNodejsSourceDependencies(source)
  const firstStamp = await fs.readFile(stamp, 'utf8')
  const require = createRequire(path.join(source, 'package.json'))

  // Loading the package verifies the actual native binding was built.
  expect(require('node-pty').spawn).toBeTypeOf('function')
  await expect(fs.stat(path.join(source, 'pnpm-workspace.yaml'))).rejects.toThrow()
  await expect(fs.stat(path.join(fixture.codebase, 'node_modules'))).rejects.toThrow()

  await syncNodejsSourceDependencies(source)
  expect(await fs.readFile(stamp, 'utf8')).toBe(firstStamp)

  // The root also supports a selective policy without any per-tool config.
  await fs.writeFile(workspace, YAML.stringify({
    allowBuilds: { 'node-pty': true },
    sideEffectsCache: false
  }))
  await syncNodejsSourceDependencies(source)
  expect(await fs.readFile(stamp, 'utf8')).not.toBe(firstStamp)

  await fs.writeFile(workspace, YAML.stringify({
    dangerouslyAllowAllBuilds: false,
    sideEffectsCache: false
  }))
  await expect(syncNodejsSourceDependencies(source)).rejects.toThrow('ERR_PNPM_IGNORED_BUILDS')
  await expect(fs.stat(stamp)).rejects.toThrow()
})
