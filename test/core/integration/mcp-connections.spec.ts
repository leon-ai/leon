import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import Fastify from 'fastify'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { startMCPFixture } from '../fixtures/mcp-server'
import { LogoMaskMode } from '../../../aurora/src/contracts/package-logo'

let home = ''
let catalog: typeof import('@/core/tool-manager/catalog/catalog')
let manager: typeof import('@/core/tool-manager/mcp/manager')
let auth: typeof import('@/core/tool-manager/mcp/auth')
let core: typeof import('@/core')
let context: typeof import('@/core/profile-runtime/profile-context')
let http: typeof import('@/core/tool-manager/mcp/http')
let installations: typeof import('@/core/tool-manager/mcp/installations')
const servers: Array<Awaited<ReturnType<typeof startMCPFixture>>> = []
const owner = <T>(profile: string, execute: () => T): T => context.runWithProfileContext({ profileName: profile }, execute)

beforeAll(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-mcp-integration-'))
  vi.stubEnv('LEON_HOME', home)
  vi.stubEnv('LEON_PROFILE', 'mcp-owner-a')
  vi.resetModules()
  for (const profile of ['mcp-owner-a', 'mcp-owner-b']) {
    const directory = path.join(home, 'profiles', profile)
    await fs.mkdir(directory, { recursive: true })
    await fs.copyFile('config.sample.yml', path.join(directory, 'config.yml'))
  }
  context = await import('@/core/profile-runtime/profile-context')
  catalog = await import('@/core/tool-manager/catalog/catalog')
  manager = await import('@/core/tool-manager/mcp/manager')
  auth = await import('@/core/tool-manager/mcp/auth')
  core = await import('@/core')
  http = await import('@/core/tool-manager/mcp/http')
  installations = await import('@/core/tool-manager/mcp/installations')
})

afterAll(async () => {
  if (catalog) {
    for (const profile of ['mcp-owner-a', 'mcp-owner-b']) {
      await owner(profile, async () => {
        for (const entry of await catalog.TOOL_CATALOG.list()) {
          if (entry.kind === 'mcp' && entry.installed) {
            await manager.MCP_MANAGER.close(entry.id)
          }
        }
      })
    }
  }
  await Promise.all(servers.map((server) => server.close()))
  if (home) {
    await fs.rm(home, { recursive: true, force: true })
  }
})

it('cancels one concurrent call without closing another call or replaying a write', async () => {
  const server = await startMCPFixture()
  servers.push(server)
  await owner('mcp-owner-a', async () => {
    const id = await catalog.TOOL_CATALOG.install({ url: server.url, name: 'Concurrent workspace' })
    const manifest = (await catalog.getInstalledMCP(id))!
    await manager.MCP_MANAGER.discover(manifest)
    const controller = new AbortController()
    const progress = vi.fn()
    const first = manager.MCP_MANAGER.call(manifest, 'workspace.echo', { value: 'hold-first' }, { signal: controller.signal })
    const second = manager.MCP_MANAGER.call(manifest, 'workspace.echo', { value: 'hold-second' }, { onProgress: progress })
    const rejected = expect(first).rejects.toThrow('Stopped by owner')
    await vi.waitFor(() => expect(server.held.size).toBe(2))
    controller.abort(new Error('Stopped by owner'))
    await rejected
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ activity: true, message: 'Reading workspace' }))
    server.held.get('hold-second')!()
    expect((await second).success).toBe(true)
    expect(server.calls.filter((call) => call.method === 'tools/call')).toHaveLength(2)
    const third = manager.MCP_MANAGER.call(manifest, 'workspace.echo', { value: 'hold-disabled' }, {})
    const stopped = expect(third).rejects.toThrow()
    await vi.waitFor(() => expect(server.held.has('hold-disabled')).toBe(true))
    await catalog.TOOL_CATALOG.act(id, 'disable')
    await stopped
    await catalog.TOOL_CATALOG.act(id, 'remove')
  })
})

it('blocks private network destinations and ignores malformed discovery snapshots', async () => {
  expect(() => http.getMCPURL('http://192.168.1.1/mcp')).toThrow()
  expect(() => http.getMCPURL('https://example.com/mcp?token=secret')).toThrow()
  const fetch = http.createMCPFetch(new URL('https://example.com/mcp'))
  await expect(fetch('https://127.0.0.1/mcp')).rejects.toThrow('not permitted')
  await expect(fetch('https://169.254.169.254/latest/meta-data')).rejects.toThrow('not permitted')
  await expect(fetch('file:///etc/passwd')).rejects.toThrow('not permitted')
  await owner('mcp-owner-a', async () => {
    const id = await catalog.TOOL_CATALOG.install({ url: 'https://example.com/mcp' })
    const manifest = (await catalog.getInstalledMCP(id))!
    const directory = path.join(home, 'profiles', 'mcp-owner-a', 'tools', manifest.toolkit_id, manifest.tool_id)
    await fs.writeFile(path.join(directory, '.mcp-tools.json'), JSON.stringify({ source: manifest.source, functions: ['bad'], requiresAuth: false }))
    expect(installations.readMCPCache(directory, manifest.source)).toBeUndefined()
    await catalog.TOOL_CATALOG.act(id, 'remove')
  })
})

it('exposes management through explicit validated requests without model startup', async () => {
  const { toolsPlugin } = await import('@/core/http-server/api/tools')
  const app = Fastify()
  await app.register(toolsPlugin, { apiVersion: 'v1' })
  try {
    await owner('mcp-owner-b', async () => {
      const before = await app.inject({ url: '/api/v1/tools/catalog' })
      expect(before.statusCode).toBe(200)
      expect(before.headers['cache-control']).toBe('no-store')
      const invalid = await app.inject({ method: 'POST', url: '/api/v1/tools', payload: { command: 'untrusted' } })
      expect(invalid.statusCode).toBe(400)
      const added = await app.inject({ method: 'POST', url: '/api/v1/tools', payload: { catalogId: 'productivity_collaboration.notion' } })
      expect(added.statusCode).toBe(201)
      const id = added.json().id
      expect(core.TOOLKIT_REGISTRY.getToolIconLogo('productivity_collaboration', 'notion')).toEqual({
        url: `tools/${id}/assets/logo.svg`, mode: LogoMaskMode.InverseLuminance
      })
      const document = await app.inject({ url: `/api/v1/tools/${id}/documents/readme` })
      expect(document.statusCode).toBe(200)
      expect(document.json().text).toContain('# Notion')
      const logo = await app.inject({ url: `/api/v1/tools/${id}/assets/logo.svg` })
      expect(logo.statusCode).toBe(200)
      expect(logo.headers['content-type']).toContain('image/svg+xml')
      expect(logo.headers['vary']).toBe('Cookie, Authorization, X-Leon-Profile-Token')
      expect(logo.headers['content-security-policy']).toContain('sandbox')
      expect((await app.inject({ method: 'POST', url: `/api/v1/tools/${id}`, payload: { action: 'disable' } })).statusCode).toBe(200)
      expect((await app.inject({ method: 'POST', url: `/api/v1/tools/${id}`, payload: { action: 'remove' } })).statusCode).toBe(200)
    })
  } finally {
    await app.close()
  }
})

it('shares a validated immutable catalog snapshot without contacting its servers', async () => {
  const { BundledToolCatalog } = await import('@/core/tool-manager/catalog/catalog-loader')
  const definition = JSON.parse(await fs.readFile('tools/productivity_collaboration/notion/tool.json', 'utf8'))
  const directory = path.join(home, 'catalog-snapshot')
  const server = await startMCPFixture()
  servers.push(server)
  await fs.mkdir(path.join(directory, 'catalog'), { recursive: true })
  for (let index = 0; index < 300; index += 1) {
    const entryDirectory = path.join(directory, 'catalog', `server-${index}`)
    await fs.mkdir(entryDirectory)
    await fs.writeFile(path.join(entryDirectory, 'tool.json'), JSON.stringify({
      ...definition, toolkit_id: 'catalog', tool_id: `server-${index}`, previous_tool_ids: [], source: { ...definition.source, url: server.url }
    }))
  }
  const loader = new BundledToolCatalog(directory)
  const [first, concurrent] = await Promise.all([loader.list(), loader.list()])
  expect(first).toHaveLength(300)
  expect(concurrent).toBe(first)
  expect(Object.isFrozen(first)).toBe(true)
  expect(Object.isFrozen(first[0]?.manifest)).toBe(true)
  await fs.writeFile(path.join(directory, 'catalog', 'server-0', 'tool.json'), 'invalid JSON')
  expect(await loader.list()).toBe(first)
  expect(server.requests).toBe(0)
})

it.each([
  { id: 'missing-endpoint', change: { source: { type: 'mcp', transport: 'http' } } },
  { id: 'credentials', change: { clientSecret: 'not-catalog-data' } },
  { id: 'remote-schemas', change: { functions: { unsafe: {} } } },
  { id: 'unsafe-identifiers', change: { tool_id: '../outside' } },
  { id: 'mismatched-toolkit', change: { toolkit_id: 'another' } },
  { id: 'unsafe-endpoint', change: { source: { type: 'mcp', transport: 'http', url: 'https://example.com/mcp?token=secret' } } },
  { id: 'insecure-client-metadata', change: { source: { type: 'mcp', transport: 'http', url: 'https://example.com/mcp',
    clientMetadataUrl: 'http://127.0.0.1/client.json' } } }
])('rejects invalid $id metadata atomically and retries after a catalog repair', async ({ id, change }) => {
  const { BundledToolCatalog } = await import('@/core/tool-manager/catalog/catalog-loader')
  const definition = JSON.parse(await fs.readFile('tools/productivity_collaboration/notion/tool.json', 'utf8'))
  const directory = path.join(home, `catalog-${id}`)
  await fs.mkdir(path.join(directory, 'productivity_collaboration', 'notion'), { recursive: true })
  await fs.mkdir(path.join(directory, 'productivity_collaboration', 'other'))
  await fs.writeFile(path.join(directory, 'productivity_collaboration', 'notion', 'tool.json'), JSON.stringify(definition))
  const other = { ...definition, tool_id: 'other', previous_tool_ids: [] }
  const filename = path.join(directory, 'productivity_collaboration', 'other', 'tool.json')
  await fs.writeFile(filename, JSON.stringify({ ...other, ...change }))
  const loader = new BundledToolCatalog(directory)
  await expect(loader.list()).rejects.toThrow('Invalid tool catalog entry "productivity_collaboration/other"')
  await fs.writeFile(filename, JSON.stringify(other))
  expect(await loader.list()).toHaveLength(2)
})
