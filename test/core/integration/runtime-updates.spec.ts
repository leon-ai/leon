import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

import { afterEach, beforeEach, expect, it } from 'vitest'

import { FileDownloader } from '@@/bridges/runtime/nodejs/file-downloader'
import { UpdateService } from '@/core/ota/update-service'
import { installRuntimeArchive, currentRuntime, activateRuntime, readInstalledRuntime, runtimeEnvironment } from '../../../scripts/distribution/runtime.js'
import { getUpdateStatePath } from '../../../scripts/update/paths.js'
import { createRuntimeArchive, runtimeFixtureHome } from '../../fixtures/runtime-update'
import { UpdatePhase } from '../../../bridges/runtime/contracts/updates'

let home: string
let installation: string
let archive: Awaited<ReturnType<typeof createRuntimeArchive>>
let api: http.Server
let origin: string
let downloadGate: Promise<void> | undefined
const download = FileDownloader.downloadFile.bind(FileDownloader)
const versions = ['2.0.0-alpha.0.1', '2.0.0-alpha.0.2'] as const

beforeEach(async () => {
  ({ home, installation } = await runtimeFixtureHome())
  downloadGate = undefined
  archive = await createRuntimeArchive(home, versions[0])
  api = http.createServer(async (request, response) => {
    await downloadGate
    const content = await fs.readFile(archive.archive)
    response.writeHead(200, { 'content-length': content.length })
    response.end(request.method === 'HEAD' ? undefined : content)
  })
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(api.address() as { port: number }).port}`
})
afterEach(async () => {
  if (api?.listening) {
    api.closeAllConnections()
    await new Promise<void>((resolve) => api.close(() => resolve()))
  }
  await fs.rm(home, { recursive: true, force: true })
})

const install = async (): Promise<Awaited<ReturnType<typeof readInstalledRuntime>>> => {
  archive.asset.url = `${origin}/${archive.asset.name}`
  return installRuntimeArchive({ installation, asset: archive.asset, download })
}

it('installs a verified archive, restores dependency links and keeps profile files separate', async () => {
  const profile = path.join(home, 'profiles/owner/credential')
  await fs.mkdir(path.dirname(profile), { recursive: true })
  await fs.writeFile(profile, 'owner-private-data')
  const runtime = await install()
  await activateRuntime(installation, versions[0])
  expect((await currentRuntime(installation)).manifest.version).toBe(versions[0])
  expect(await fs.readFile(profile, 'utf8')).toBe('owner-private-data')
  expect((await fs.stat(path.join(runtime.root, 'node_modules/tar/package.json'))).isFile()).toBe(true)
  expect(await fs.stat(path.join(installation, 'downloads', archive.asset.name)).catch(() => null)).toBeNull()
  expect((await install()).root).toBe(runtime.root)
  archive.asset.sha256 = '0'.repeat(64)
  await expect(install()).rejects.toThrow('another archive')
})

it('rejects checksum failures before selecting a runtime', async () => {
  archive.asset.sha256 = '0'.repeat(64)
  await expect(install()).rejects.toThrow('checksum')
  await expect(fs.stat(path.join(installation, 'active.json'))).rejects.toThrow()
  await expect(fs.stat(path.join(installation, 'versions', versions[0]))).rejects.toThrow()
})

it('rejects dependency links outside a runtime without replacing profile data', async () => {
  const profile = path.join(home, 'profiles/owner/private')
  await fs.mkdir(path.dirname(profile), { recursive: true })
  await fs.writeFile(profile, 'keep my data')
  archive = await createRuntimeArchive(home, versions[1], { escape: true })
  await expect(install()).rejects.toThrow('leaves its version directory')
  expect(await fs.readFile(profile, 'utf8')).toBe('keep my data')
  await expect(fs.stat(path.join(installation, 'active.json'))).rejects.toThrow()
})

it('uses the same update API to pin and stage a prebuilt release without Git or source setup', async () => {
  const initial = await install()
  await activateRuntime(installation, versions[0])
  archive = await createRuntimeArchive(home, versions[1])
  const release = { tag_name: `v${versions[1]}`, name: 'A new server', published_at: new Date().toISOString(),
    body: 'Ready to use.', html_url: `${origin}/release`, draft: false, prerelease: true }
  const service = new UpdateService({ root: initial.root, home, runtimeHome: installation, managed: true,
    releases: async (): Promise<typeof release[]> => [release], runtimeAssets: async (): Promise<{ baseURL: string, manifest: unknown }> => ({ baseURL: `${origin}/`,
      manifest: { schemaVersion: 1, version: versions[1], assets: [archive.asset] } }) })
  expect((await service.check()).canInstall).toBe(true)
  const gate = Promise.withResolvers<void>()
  downloadGate = gate.promise
  const deadline = new AbortController()
  try {
    const snapshot = await Promise.race([
      service.prepare(release.tag_name),
      delay(3_000, null, { signal: deadline.signal }).catch(() => null)
    ])
    assert(snapshot, 'An accepted update must not wait for its archive download')
    expect(snapshot.state?.phase).toBe(UpdatePhase.Scheduled)
    await expect(fs.stat(path.join(installation, 'versions', versions[1]))).rejects.toThrow()
  } finally {
    deadline.abort()
    gate.resolve()
  }
  await service.waitUntilPrepared()
  expect((await currentRuntime(installation)).manifest.version).toBe(versions[0])
  expect((await readInstalledRuntime(path.join(installation, 'versions', versions[1]))).manifest.version).toBe(versions[1])
  const state = JSON.parse(await fs.readFile(getUpdateStatePath(home, initial.root, installation), 'utf8'))
  expect(state.asset.sha256).toBe(archive.asset.sha256)
  expect(state.kind).toBe('runtime')
})

it.skipIf(process.platform === 'win32')('restarts into a staged release through the launcher and completes its update receipt', async () => {
  const initial = await install()
  await activateRuntime(installation, versions[0])
  archive = await createRuntimeArchive(home, versions[1])
  await install()
  const portProbe = http.createServer()
  await new Promise<void>((resolve) => portProbe.listen(0, '127.0.0.1', resolve))
  const port = (portProbe.address() as { port: number }).port
  await new Promise<void>((resolve) => portProbe.close(() => resolve()))
  const statePath = getUpdateStatePath(home, initial.root, installation)
  await fs.mkdir(path.dirname(statePath), { recursive: true })
  const child = spawn(process.execPath, [path.join(initial.root, 'scripts/run-runtime.js')], {
    cwd: initial.root, env: { ...runtimeEnvironment(initial, installation, { ...process.env, LEON_HOME: home }),
      FIXTURE_PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe']
  })
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
  let diagnostics = ''
  child.stderr?.on('data', (chunk) => {
    diagnostics += chunk
  })
  const waitForVersion = async (version: string): Promise<void> => {
    const deadline = Date.now() + 10_000
    let result
    while (Date.now() < deadline && child.exitCode === null) {
      result = await fetch(`http://127.0.0.1:${port}`).then((response) => response.text()).catch(() => null)
      if (result === version) {
        return
      }
      await delay(25)
    }
    assert.equal(result, version, diagnostics)
  }
  try {
    await waitForVersion(versions[0])
    await fs.writeFile(statePath, JSON.stringify({ id: 'owner-update', kind: 'runtime', phase: UpdatePhase.Scheduled,
      version: versions[1], expectedVersion: versions[0], installation, root: initial.root,
      asset: archive.asset, profile: 'owner', error: null }))
    await fetch(`http://127.0.0.1:${port}/update`)
    await waitForVersion(versions[1])
    expect((await currentRuntime(installation)).manifest.version).toBe(versions[1])
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'))
    expect(state.phase).toBe(UpdatePhase.Completed)
  } finally {
    child.kill('SIGTERM')
    await closed
  }
})

it.skipIf(process.platform === 'win32')('recovers the previous runtime when the selected candidate cannot become ready', async () => {
  const initial = await install()
  await activateRuntime(installation, versions[0])
  archive = await createRuntimeArchive(home, versions[1], { broken: true })
  const candidate = await install()
  const portProbe = http.createServer()
  await new Promise<void>((resolve) => portProbe.listen(0, '127.0.0.1', resolve))
  const port = (portProbe.address() as { port: number }).port
  await new Promise<void>((resolve) => portProbe.close(() => resolve()))
  const statePath = getUpdateStatePath(home, initial.root, installation)
  await fs.mkdir(path.dirname(statePath), { recursive: true })
  await fs.writeFile(statePath, JSON.stringify({ id: 'owner-update', kind: 'runtime', phase: UpdatePhase.Restarting,
    version: versions[1], expectedVersion: versions[0], installation, root: initial.root, asset: archive.asset, profile: 'owner', error: null }))
  await activateRuntime(installation, versions[1])
  const child = spawn(process.execPath, [path.join(initial.root, 'scripts/run-runtime.js')], {
    cwd: initial.root, env: { ...runtimeEnvironment(candidate, installation, { ...process.env, LEON_HOME: home }),
      FIXTURE_PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe']
  })
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
  let diagnostics = ''
  child.stderr?.on('data', (chunk) => {
    diagnostics += chunk
  })
  try {
    const deadline = Date.now() + 10_000
    let result
    while (Date.now() < deadline && child.exitCode === null) {
      result = await fetch(`http://127.0.0.1:${port}`).then((response) => response.text()).catch(() => null)
      if (result === versions[0]) {
        break
      }
      await delay(25)
    }
    assert.equal(result, versions[0], `The old runtime must answer after candidate startup fails: ${diagnostics}`)
    expect((await currentRuntime(installation)).manifest.version).toBe(versions[0])
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'))
    expect(state.phase).toBe(UpdatePhase.Failed)
    expect(state.error).toContain('startup')
  } finally {
    child.kill('SIGTERM')
    await closed
  }
})
