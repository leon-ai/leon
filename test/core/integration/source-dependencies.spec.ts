import fs from 'node:fs/promises'
import http from 'node:http'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import { execa } from 'execa'
import { afterEach, expect, it, vi } from 'vitest'
import YAML from 'yaml'

import { PYTHON_RUNTIME_BIN_PATH } from '@/constants'

import {
  syncNodejsSourceDependencies,
  syncPythonSourceDependencies
} from '@@/scripts/setup/sync-source-dependencies'
import {
  getProjectVenvPythonPath,
  isPythonProjectSyncCurrent,
  setupPythonProjectEnv
} from '@@/scripts/setup/setup-python-project-env'

const fixture = vi.hoisted(() => ({ codebase: '', mirror: '', origin: '' }))

// Route only the public endpoints to disposable HTTP indexes; uv still resolves,
// checks timestamps and hashes, downloads wheels and installs real packages.
vi.mock('@@/bridges/runtime/nodejs/download-region.js', async (importOriginal) => {
  const region = await importOriginal<typeof import('@@/bridges/runtime/nodejs/download-region.js')>()

  return {
    ...region,
    get CHINA_PYPI_INDEX(): string {
      return fixture.mirror || region.CHINA_PYPI_INDEX
    },
    get PUBLIC_PYPI_INDEX(): string {
      return fixture.origin || region.PUBLIC_PYPI_INDEX
    },
    async getRegionalInstallerEnvironment(
      ...args: Parameters<typeof region.getRegionalInstallerEnvironment>
    ): ReturnType<typeof region.getRegionalInstallerEnvironment> {
      const environment = await region.getRegionalInstallerEnvironment(...args)

      if (fixture.mirror && environment.UV_INDEX === region.CHINA_PYPI_INDEX) {
        environment.UV_INDEX = fixture.mirror
        environment.UV_DEFAULT_INDEX = fixture.origin
      }

      return environment
    }
  }
})

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
let indexServer: http.Server | undefined

afterEach(async () => {
  vi.restoreAllMocks()
  fixture.mirror = ''
  fixture.origin = ''

  if (indexServer) {
    indexServer.closeAllConnections()
    await new Promise<void>((resolve) => indexServer!.close(() => resolve()))
    indexServer = undefined
  }

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

it.each([
  'missing-timestamp', 'index-failure', 'archive-failure', 'archive-corruption',
  'public-unavailable', 'recent-release',
  'private-config', 'private-config-failure', 'owner-index', 'owner-index-failure'
])('installs through public fallback without relaxing policy or private index isolation (%s)', async (mode) => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-python-indexes-'))
  fixture.codebase = path.join(directory, 'codebase')
  const source = path.join(directory, 'project')
  const wheelName = 'fixture_wheel-1.0.0-py3-none-any.whl'
  const wheelPath = path.join(directory, wheelName)
  const stampName = '.synced'
  const privateIndex = mode.startsWith('private-config') || mode.startsWith('owner-index')
  const requests: string[] = []

  await fs.mkdir(fixture.codebase)
  await fs.mkdir(source)
  await execa(PYTHON_RUNTIME_BIN_PATH, ['-c', `
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], 'w') as wheel:
    wheel.writestr('fixture_wheel/__init__.py', 'VALUE = "verified"')
    wheel.writestr('fixture_wheel-1.0.0.dist-info/METADATA', 'Metadata-Version: 2.1\\nName: fixture-wheel\\nVersion: 1.0.0\\n')
    wheel.writestr('fixture_wheel-1.0.0.dist-info/WHEEL', 'Wheel-Version: 1.0\\nGenerator: fixture\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n')
    wheel.writestr('fixture_wheel-1.0.0.dist-info/RECORD', '')
`, wheelPath])
  const wheel = await fs.readFile(wheelPath)
  const sha256 = createHash('sha256').update(wheel).digest('hex')

  indexServer = http.createServer((request, response) => {
    const url = request.url || ''
    const mirror = url.startsWith('/mirror/')
    requests.push(url)

    if (mode === 'public-unavailable' || mode.endsWith('-failure') && privateIndex || mirror &&
        (mode === 'index-failure' || mode === 'archive-failure' && url.endsWith('.whl'))) {
      response.writeHead(503).end('Unavailable')
      return
    }
    if (url.endsWith('.whl')) {
      response.writeHead(200, { 'content-type': 'application/octet-stream' }).end(mirror && mode === 'archive-corruption' ? Buffer.from('corrupt wheel') : wheel)
      return
    }

    const prefix = url.split('/')[1]
    const uploaded = mode === 'recent-release' ? new Date().toISOString() : '2020-01-01T00:00:00Z'
    response.writeHead(200, { 'content-type': 'application/vnd.pypi.simple.v1+json' }).end(JSON.stringify({
      meta: { 'api-version': '1.0' },
      name: 'fixture-wheel',
      files: [{
        filename: wheelName,
        url: `/${prefix}/${wheelName}`,
        hashes: { sha256 },
        ...(!(mirror && mode === 'missing-timestamp') ? { 'upload-time': uploaded } : {})
      }]
    }))
  })
  await new Promise<void>((resolve) => indexServer!.listen(0, '127.0.0.1', resolve))
  const { port } = indexServer.address() as import('node:net').AddressInfo
  const origin = `http://127.0.0.1:${port}`
  fixture.mirror = `${origin}/mirror/simple/`
  fixture.origin = `${origin}/origin/simple/`

  for (const key of [
    'UV_DEFAULT_INDEX', 'UV_INDEX', 'UV_INDEX_URL', 'UV_EXTRA_INDEX_URL', 'UV_INDEX_STRATEGY',
    'PIP_INDEX_URL', 'PIP_EXTRA_INDEX_URL', 'UV_CONFIG_FILE'
  ]) {
    vi.stubEnv(key, undefined)
  }
  vi.stubEnv('LEON_DOWNLOAD_REGION', 'cn')
  vi.stubEnv('UV_CACHE_DIR', path.join(directory, 'cache'))
  vi.stubEnv('UV_HTTP_RETRIES', '0')
  vi.stubEnv('XDG_CONFIG_HOME', path.join(directory, 'config'))
  vi.stubEnv('APPDATA', '')
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null))

  let policy = 'exclude-newer = "36 hours"\n'
  if (mode.startsWith('private-config')) {
    policy += `[[index]]\nname = "company"\nurl = "${origin}/private/simple/"\ndefault = true\n`
  } else if (mode.startsWith('owner-index')) {
    vi.stubEnv('UV_DEFAULT_INDEX', `${origin}/private/simple/`)
  }
  await fs.writeFile(path.join(fixture.codebase, 'uv.toml'), policy)
  await fs.writeFile(path.join(source, 'pyproject.toml'), `
[project]
name = "source-fixture"
version = "1.0.0"
dependencies = ["fixture-wheel==1.0.0"]
`)
  const install = setupPythonProjectEnv({ name: 'Index fixture', projectPath: source, stampFileName: stampName })
  const fails = mode === 'recent-release' || mode === 'public-unavailable' || privateIndex && mode.endsWith('-failure')

  if (fails) {
    await expect(install).rejects.toThrow()
    await expect(fs.stat(path.join(source, stampName))).rejects.toThrow()
  } else {
    await install
    const { stdout } = await execa(getProjectVenvPythonPath(source), [
      '-c', 'import fixture_wheel; print(fixture_wheel.VALUE)'
    ])
    expect(stdout).toBe('verified')
    expect(await isPythonProjectSyncCurrent(source, stampName)).toBe(true)
  }

  if (privateIndex) {
    expect(requests.length).toBeGreaterThan(0)
    expect(requests.every((url) => url.startsWith('/private/'))).toBe(true)
  } else {
    expect(requests.some((url) => url.startsWith('/mirror/'))).toBe(true)
    expect(requests.some((url) => url.startsWith('/origin/'))).toBe(true)
    expect(requests.filter((url) => url === '/mirror/simple/fixture-wheel/')).toHaveLength(1)
    expect(requests.filter((url) => url === '/origin/simple/fixture-wheel/').length).toBeLessThanOrEqual(2)
  }
})
