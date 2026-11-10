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

it('completes PKCE sign-in once in its originating profile and clears encrypted grants on disconnect', async () => {
  const server = await startMCPFixture(true)
  servers.push(server)
  await owner('mcp-owner-a', async () => {
    const id = await catalog.TOOL_CATALOG.install({ url: server.url, name: 'Private workspace' })
    const manifest = (await catalog.getInstalledMCP(id))!
    await expect(manager.MCP_MANAGER.discover(manifest)).rejects.toThrow(auth.MCPAuthenticationRequired)
    const rejected = await manager.startMCPOAuth(manifest, server.origin,
      `${server.origin}/api/v1/connections/complete?channel=fixture`, 'v1')
    const invalidAuthorization = await fetch(rejected.authorization_url!, { redirect: 'manual' })
    const invalidCallback = new URL(invalidAuthorization.headers.get('location')!)
    invalidCallback.searchParams.set('iss', 'https://another-issuer.example')
    const refused = await manager.completeMCPOAuth(invalidCallback.searchParams)
    expect(new URL(refused!).searchParams.get('connection_result')).toBe('failed')
    expect(server.tokenExchanges).toBe(0)
    const result = await manager.startMCPOAuth(manifest, server.origin,
      `${server.origin}/api/v1/connections/complete?channel=fixture`, 'v1')
    expect(result.authorization_url).toBeTruthy()
    const authorization = await fetch(result.authorization_url!, { redirect: 'manual' })
    const callback = new URL(authorization.headers.get('location')!)
    const completion = await owner('mcp-owner-b', () => manager.completeMCPOAuth(callback.searchParams))
    expect(new URL(completion!).searchParams.get('connection_result')).toBe('connected')
    expect(await manager.completeMCPOAuth(callback.searchParams)).toBeUndefined()
    expect(server.tokenExchanges).toBe(1)
    expect((await owner('mcp-owner-b', () => auth.MCP_CONNECTIONS.list()))).toHaveLength(0)
    expect((await catalog.TOOL_CATALOG.list()).find((entry) => entry.id === id)?.connected).toBe(true)
    const saved = await fs.readFile(path.join(home, 'profiles', 'mcp-owner-a', 'connections', 'mcp', `${id}.json`), 'utf8')
    expect(saved).not.toContain('fixture-access-secret')
    expect(saved).not.toContain('fixture-refresh-secret')
    expect(JSON.stringify(await catalog.TOOL_CATALOG.list())).not.toContain('secret')
    await catalog.TOOL_CATALOG.act(id, 'disconnect')
    expect(await auth.MCP_CONNECTIONS.getCredentials(id)).toBeNull()
    expect((await catalog.TOOL_CATALOG.list()).find((entry) => entry.id === id)?.connected).toBe(false)
    const reconnect = await manager.startMCPOAuth(manifest, server.origin,
      `${server.origin}/api/v1/connections/complete?channel=fixture`, 'v1')
    const returnTo = await fetch(reconnect.authorization_url!, { redirect: 'manual' })
    server.oauth.hold = true
    const finishing = manager.completeMCPOAuth(new URL(returnTo.headers.get('location')!).searchParams)
    await vi.waitFor(() => expect(server.held.has('oauth-token')).toBe(true))
    await catalog.TOOL_CATALOG.act(id, 'remove')
    server.held.get('oauth-token')?.()
    expect(new URL((await finishing)!).searchParams.get('connection_result')).toBe('failed')
    expect(await auth.MCP_CONNECTIONS.getCredentials(id)).toBeNull()
    expect(await catalog.getInstalledMCP(id)).toBeUndefined()
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

it('requires explicit profile activation for native extensions without changing disablement or saved settings', async () => {
  const id = 'communication.gmail'
  await owner('mcp-owner-a', async () => {
    await core.TOOLKIT_REGISTRY.reload()
    expect(core.TOOLKIT_REGISTRY.resolveToolById('gmail', 'communication')).toBeNull()
    expect((await catalog.TOOL_CATALOG.list()).find((entry) => entry.id === id)).toMatchObject({
      installed: false, distribution: 'extension', maintenance: 'official'
    })
    await catalog.TOOL_CATALOG.install({ catalogId: id })
    expect(core.TOOLKIT_REGISTRY.resolveToolById('gmail', 'communication')).not.toBeNull()
    await owner('mcp-owner-b', async () => {
      await core.TOOLKIT_REGISTRY.reload()
      expect(core.TOOLKIT_REGISTRY.resolveToolById('gmail', 'communication')).toBeNull()
    })
    await catalog.TOOL_CATALOG.act(id, 'disable')
    expect(core.TOOLKIT_REGISTRY.resolveToolById('gmail', 'communication')).toBeNull()
    await catalog.TOOL_CATALOG.act(id, 'remove')
    const settings = path.join(home, 'profiles', 'mcp-owner-a', 'tools', 'communication', 'gmail', 'settings.json')
    await expect(fs.access(settings)).resolves.toBeUndefined()
    await catalog.TOOL_CATALOG.install({ catalogId: id })
    expect((await catalog.TOOL_CATALOG.list()).find((entry) => entry.id === id)).toMatchObject({ installed: true, enabled: false })
    await catalog.TOOL_CATALOG.act(id, 'remove')
  })
})

it('retains installed identities and curated documentation only for the declared server', async () => {
  await owner('mcp-owner-a', async () => {
    const id = await catalog.TOOL_CATALOG.install({ catalogId: 'productivity_collaboration.notion' })
    const installed = (await catalog.TOOL_CATALOG.list()).find((entry) => entry.id === id)!
    expect(installed).toMatchObject({ maintenance: 'official', documents: { readme: true } })
    const definition = (await catalog.toolDefinitions()).find((entry) => entry.manifest.tool_id === 'notion')!
    const { FileHelper } = await import('@/helpers/file-helper')
    const legacyId = 'productivity_collaboration.notion-mcp'
    const legacyDirectory = path.join(path.dirname(definition.directory), 'notion-mcp')
    await fs.rename(definition.directory, legacyDirectory)
    await FileHelper.writeAtomicJSON(path.join(legacyDirectory, 'tool.json'), {
      ...definition.manifest, tool_id: 'notion-mcp'
    })
    const toolkitPath = path.join(path.dirname(definition.directory), 'toolkit.json')
    const toolkit = JSON.parse(await fs.readFile(toolkitPath, 'utf8'))
    await FileHelper.writeAtomicJSON(toolkitPath, {
      ...toolkit, tools: toolkit.tools.map((tool: string) => tool === 'notion' ? 'notion-mcp' : tool)
    })
    await auth.MCP_CONNECTIONS.save({ provider: legacyId, auth_type: 'oauth',
      credentials: { source: definition.manifest.source, oauth: { tokens: { access_token: 'legacy-grant' } } } })
    const credentialsPath = path.join(home, 'profiles', 'mcp-owner-a', 'connections', 'mcp', `${legacyId}.json`)
    const encrypted = await fs.readFile(credentialsPath, 'utf8')
    await core.TOOLKIT_REGISTRY.reload()
    const aliases = (await catalog.TOOL_CATALOG.list()).filter((entry) => entry.id === id || entry.id === legacyId)
    expect(aliases).toHaveLength(1)
    expect(aliases[0]).toMatchObject({ id: legacyId, installed: true, maintenance: 'official', documents: { readme: true } })
    expect(await catalog.getInstalledMCP(legacyId)).toMatchObject({ tool_id: 'notion-mcp', source: definition.manifest.source })
    expect(await auth.MCP_CONNECTIONS.getCredentials(legacyId)).toMatchObject({ oauth: { tokens: { access_token: 'legacy-grant' } } })
    expect(await fs.readFile(credentialsPath, 'utf8')).toBe(encrypted)
    await FileHelper.writeAtomicJSON(path.join(legacyDirectory, 'tool.json'), {
      ...definition.manifest, tool_id: 'notion-mcp', maintenance: 'official',
      source: { type: 'mcp', transport: 'http', url: 'https://example.com/mcp' }
    })
    const changed = (await catalog.TOOL_CATALOG.list()).find((entry) => entry.id === legacyId)!
    expect(changed.maintenance).toBeUndefined()
    expect(changed.documents?.readme).toBe(false)
    await catalog.TOOL_CATALOG.act(legacyId, 'remove')
    expect(await auth.MCP_CONNECTIONS.getCredentials(legacyId)).toBeNull()
  })
})

it('edits an installed server’s public OAuth application through trusted setup without reinstalling or using chat credentials', async () => {
  const { setupMCPConnection } = await import('@/core/tool-manager/mcp/setup')
  const { ConnectionSetupActionId: Action } = await import('../../../aurora/src/contracts/connection-setup')
  const server = await startMCPFixture(true)
  servers.push(server)
  await owner('mcp-owner-a', async () => {
    const id = await catalog.TOOL_CATALOG.install({ url: server.url, name: 'Public OAuth workspace' })
    try {
      const input = { provider: id, session_id: '', callback_origin: 'http://127.0.0.1:1337', api_version: 'v1' }
      const screen = await setupMCPConnection({ ...input, action: Action.Credentials })
      expect(screen?.view.fields.map((field) => field.name)).toEqual(['client_id', 'client_metadata_url'])
      expect(server.requests).toBe(0)
      const result = await setupMCPConnection({ ...input, action: Action.Connect, state: screen!.view.state,
        credentials: { client_id: 'fixture-client', client_metadata_url: '' } })
      expect(new URL(result!.authorization_url!).searchParams.get('client_id')).toBe('fixture-client')
      expect((await catalog.getInstalledMCP(id))?.source.clientId).toBe('fixture-client')
      expect((await catalog.TOOL_CATALOG.list()).find((entry) => entry.id === id)?.connected).toBe(false)
    } finally {
      await catalog.TOOL_CATALOG.act(id, 'remove')
    }
  })
})

it('serves package-local documentation and images without leaking neighboring files or requesting remote assets', async () => {
  const { readCatalogDocument, readCatalogAsset } = await import('@/core/catalog/presentation')
  const directory = path.join(home, 'package-documents')
  await fs.mkdir(path.join(directory, 'media'), { recursive: true })
  await fs.writeFile(path.join(directory, 'README.md'), '# Example\n\n![Preview](media/screen.png)\n\n![Remote](https://example.com/tracker.png)')
  await fs.writeFile(path.join(directory, 'media', 'screen.png'), 'fixture')
  const secret = path.join(home, 'private.json')
  await fs.writeFile(secret, 'private fixture')
  await fs.symlink(secret, path.join(directory, 'media', 'escape.png'))
  const document = await readCatalogDocument(directory, 'readme', '/api/v1/tools/example.tool')
  expect(document.text).toContain('/api/v1/tools/example.tool/assets/media/screen.png')
  expect(document.text).not.toContain('https://example.com/tracker.png')
  expect((await readCatalogAsset(directory, 'media/screen.png')).type).toBe('image/png')
  await expect(readCatalogAsset(directory, 'media/escape.png')).rejects.toThrow('outside the package')
  await expect(readCatalogAsset(directory, '../private.json')).rejects.toThrow('Unknown package asset')
  await expect(readCatalogDocument(directory, '../private', '')).rejects.toThrow('Unknown document')
})

it('uses existing skill formats for profile-scoped catalog metadata and availability without trusting imported official labels', async () => {
  const { SKILL_CATALOG } = await import('@/core/catalog/skills')
  const { SkillDomainHelper } = await import('@/helpers/skill-domain-helper')
  const { skillsPlugin } = await import('@/core/http-server/api/skills')
  const profile = path.join(home, 'profiles', 'mcp-owner-a')
  const directory = path.join(profile, 'skills', 'agent', 'catalog-example')
  await fs.mkdir(directory, { recursive: true })
  const metadata = { author: { name: 'Original creator', discord: { id: '123456789012345678', username: 'maker' } },
    maintainers: [{ name: 'Current maintainer', github: 'maintainer' }], maintenance: 'official' }
  await fs.writeFile(path.join(directory, 'SKILL.md'), [
    '---', 'name: catalog-example', 'description: >-', '  Find useful workspace examples.',
    'metadata:', '  author: Original creator', '  version: "2.0.0"', '---', '', 'Use the existing workspace tools.'
  ].join('\n'))
  await fs.writeFile(path.join(directory, 'skill.json'), JSON.stringify({ format: 'agent-skill', ...metadata }))
  const app = Fastify()
  await app.register(skillsPlugin, { apiVersion: 'v1' })
  try {
    await owner('mcp-owner-a', async () => {
      const entry = (await SKILL_CATALOG.list()).find((item) => item.id === 'catalog-example')!
      expect(entry).toMatchObject({ installed: true, owned: true, kind: 'agent', version: '2.0.0',
        description: 'Find useful workspace examples.', author: metadata.author, maintainers: metadata.maintainers })
      expect(entry.maintenance).toBeUndefined()
      expect((await app.inject({ url: '/api/v1/skills/catalog' })).statusCode).toBe(200)
      expect((await app.inject({ method: 'POST', url: '/api/v1/skills/catalog-example', payload: { action: 'disable' } })).statusCode).toBe(200)
      expect(SkillDomainHelper.getSkillDescriptorSync('catalog-example')).toBeNull()
      await SKILL_CATALOG.act('catalog-example', 'enable')
      expect(SkillDomainHelper.getSkillDescriptorSync('catalog-example')).not.toBeNull()
      await fs.unlink(path.join(directory, 'skill.json'))
      expect(SkillDomainHelper.getSkillDescriptorSync('catalog-example')).toMatchObject({ name: 'catalog-example' })
      await fs.writeFile(path.join(directory, 'skill.json'), JSON.stringify({ unrelated: 'third-party configuration' }))
      expect(SkillDomainHelper.getSkillDescriptorSync('catalog-example')).toMatchObject({ name: 'catalog-example' })
    })
    expect((await owner('mcp-owner-b', () => SKILL_CATALOG.list())).some((item) => item.id === 'catalog-example')).toBe(false)
  } finally {
    await app.close()
  }
})

it('preserves configured integration activation during retryable setup without enabling fresh suggestions or replacing Notion credentials', async () => {
  const { default: migrate } = await import('../../../scripts/setup/migrations/2026111012260200-preserve-configured-tool-extensions')
  const profile = path.join(home, 'migration-profile')
  const paths = { tools: path.join(profile, 'tools'), connections: path.join(profile, 'connections') }
  await fs.mkdir(paths.connections, { recursive: true })
  await migrate(paths)
  await expect(fs.access(paths.tools)).rejects.toThrow()
  const directory = path.join(paths.tools, 'communication', 'gmail')
  await fs.mkdir(directory, { recursive: true })
  const settings = JSON.stringify({ access_token: 'fixture-token' })
  await fs.writeFile(path.join(directory, 'settings.json'), settings)
  const notion = path.join(paths.connections, 'productivity_collaboration.notion.json')
  await fs.writeFile(notion, 'original encrypted fixture')
  await migrate(paths)
  const receipt = path.join(directory, '.installation.json')
  expect(JSON.parse(await fs.readFile(receipt, 'utf8'))).toEqual({ installed: true })
  await fs.writeFile(receipt, JSON.stringify({ installed: false }))
  await migrate(paths)
  expect(JSON.parse(await fs.readFile(receipt, 'utf8'))).toEqual({ installed: false })
  expect(await fs.readFile(path.join(directory, 'settings.json'), 'utf8')).toBe(settings)
  expect(await fs.readFile(notion, 'utf8')).toBe('original encrypted fixture')
  await expect(fs.access(path.join(paths.tools, 'productivity_collaboration', 'notion', 'tool.json'))).rejects.toThrow()
})
