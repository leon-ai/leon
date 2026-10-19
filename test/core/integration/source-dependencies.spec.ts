import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import execa from 'execa'
import { afterEach, expect, it, vi } from 'vitest'
import YAML from 'yaml'

import {
  syncNodejsSourceDependencies,
  syncPythonSourceDependencies
} from '@@/scripts/setup/sync-source-dependencies'
import {
  getProjectVenvPythonPath,
  isPythonProjectSyncCurrent,
  setupPythonProjectEnv
} from '@@/scripts/setup/setup-python-project-env'

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

it('applies source-local hooks and root release policy, and resyncs when they change', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-source-pins-'))
  fixture.codebase = path.join(directory, 'codebase')

  const source = path.join(fixture.codebase, 'tool', 'src', 'nodejs')
  const workspace = path.join(fixture.codebase, 'pnpm-workspace.yaml')
  const hook = path.join(source, '.pnpmfile.mjs')
  const stamp = path.join(source, '.last-source-deps-sync')
  const writeHook = async (version: string): Promise<void> => {
    await fs.writeFile(hook, `export const hooks = {
      updateConfig(config) {
        return { ...config, overrides: { 'is-number': '${version}' } }
      }
    }`)
  }

  await fs.mkdir(fixture.codebase, { recursive: true })
  await fs.mkdir(source, { recursive: true })
  await fs.writeFile(path.join(fixture.codebase, 'package.json'), JSON.stringify({
    private: true,
    dependencies: { 'is-number': '7.0.0' }
  }))
  await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({
    private: true,
    dependencies: { 'is-number': '^7.0.0' }
  }))
  await fs.writeFile(workspace, '{}')
  await writeHook('6.0.0')

  await syncNodejsSourceDependencies(source)

  const require = createRequire(path.join(source, 'package.json'))
  const versionPath = require.resolve('is-number/package.json')
  const firstStamp = await fs.readFile(stamp, 'utf8')

  expect(JSON.parse(await fs.readFile(versionPath, 'utf8')).version).toBe('6.0.0')

  await syncNodejsSourceDependencies(source)
  expect(await fs.readFile(stamp, 'utf8')).toBe(firstStamp)

  await writeHook('7.0.0')
  // Configuration content, rather than timestamp precision, determines resync.
  const syncedAt = (await fs.stat(stamp)).mtime

  await fs.utimes(hook, syncedAt, syncedAt)
  await syncNodejsSourceDependencies(source)

  const resolved = await fs.realpath(path.join(source, 'node_modules', 'is-number', 'package.json'))

  expect(JSON.parse(await fs.readFile(resolved, 'utf8')).version).toBe('7.0.0')
  expect(await fs.readFile(stamp, 'utf8')).not.toBe(firstStamp)
  await expect(fs.stat(path.join(fixture.codebase, 'node_modules'))).rejects.toThrow()
  await expect(fs.stat(path.join(source, 'pnpm-workspace.yaml'))).rejects.toThrow()

  // A cutoff at the Unix epoch excludes every published registry version.
  await fs.writeFile(workspace, YAML.stringify({
    minimumReleaseAge: Math.ceil(Date.now() / 60_000),
    minimumReleaseAgeStrict: true
  }))
  await expect(syncNodejsSourceDependencies(source)).rejects.toThrow('minimumReleaseAge')
  await expect(fs.stat(stamp)).rejects.toThrow()
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

it('enforces root Python release policy and scoped exceptions for project and standalone installs', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-python-release-policy-'))
  fixture.codebase = path.join(directory, 'codebase')

  const policy = path.join(fixture.codebase, 'uv.toml')
  const stampName = '.last-source-deps-sync'
  const installers = [
    syncPythonSourceDependencies,
    async (projectPath: string): Promise<void> => {
      await setupPythonProjectEnv({
        name: 'Python project',
        projectPath,
        stampFileName: stampName
      })
    }
  ]

  await fs.mkdir(fixture.codebase, { recursive: true })

  for (const [index, install] of installers.entries()) {
    const source = path.join(directory, 'profile', `source-${index}`)
    const stamp = path.join(source, stampName)

    await fs.mkdir(source, { recursive: true })
    await fs.writeFile(path.join(source, 'pyproject.toml'), `
[project]
name = "policy-fixture"
version = "1.0.0"
dependencies = ["idna==3.10"]

[tool.uv]
exclude-newer = false
`)
    await fs.writeFile(policy, 'exclude-newer = "36 hours"')
    await install(source)

    const { stdout } = await execa(getProjectVenvPythonPath(source), [
      '-c',
      'import idna; print(idna.__version__)'
    ])

    expect(stdout).toBe('3.10')
    expect(await isPythonProjectSyncCurrent(source, stampName)).toBe(true)

    // Existing environments must be rechecked when the shared cutoff changes.
    await fs.writeFile(policy, 'exclude-newer = "1980-01-01T00:00:00Z"')
    await expect(install(source)).rejects.toThrow('No solution found')
    await expect(fs.stat(stamp)).rejects.toThrow()

    await fs.writeFile(policy, `
exclude-newer = "1980-01-01T00:00:00Z"
exclude-newer-package = { idna = "2025-01-01T00:00:00Z" }
`)
    await install(source)
    expect(await isPythonProjectSyncCurrent(source, stampName)).toBe(true)
  }
})
