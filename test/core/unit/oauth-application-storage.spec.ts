import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  directory: '',
  key: '',
  settings: {} as Record<string, unknown>,
  tool: {
    toolkit_id: 'example', tool_id: 'account', name: 'Example',
    connection: {
      required_settings: ['access_token'],
      methods: {
        oauth: {
          settings: { client_id: null, client_secret: null },
          supports_refresh: true, token_auth: 'basic', token_format: 'json',
          scopes: [], token_url: 'https://example.com/token'
        }
      }
    }
  }
}))

vi.mock('@/config', () => ({
  CONFIG_MANAGER: { resolveSecretReference: (): string => fixture.key }
}))
vi.mock('@/constants', () => ({
  HOST: 'http://localhost', IS_PRODUCTION_ENV: false, WEB_APP_DEV_SERVER_PORT: 3_000
}))
vi.mock('@/core/profile-runtime/profile-paths', () => ({
  getProfilePaths: (profile = 'test'): { connections: string } => ({
    connections: path.join(fixture.directory, profile, 'connections')
  })
}))
vi.mock('@/helpers/profile-helper', () => ({
  ProfileHelper: {
    updateDotEnvVariable: async (_name: string, value: string): Promise<void> => {
      fixture.key = value
    }
  }
}))
vi.mock('@sdk/toolkit-config', () => ({
  ToolkitConfig: {
    loadToolSettings: (): Record<string, unknown> => ({ ...fixture.settings }),
    saveToolSettings: (_toolkit: string, _tool: string, values: Record<string, unknown>): void => {
      Object.assign(fixture.settings, values)
    }
  }
}))
vi.mock('@/core', () => ({
  TOOLKIT_REGISTRY: {
    getConnectionTool: (): typeof fixture.tool => fixture.tool,
    getConnectionTools: (): Array<typeof fixture.tool> => [fixture.tool]
  },
  TOOL_WORKER_MANAGER: {
    execute: async (): Promise<Record<string, unknown>> => ({ success: true, output: { result: {} } })
  }
}))
vi.mock('@/core/profile-runtime/initialize-profile-runtime', () => ({
  ensureActiveProfileRuntime: async (): Promise<void> => undefined
}))

import { runWithProfileContext } from '@/core/profile-runtime/profile-context'
import { CONNECTION_STORE, OAUTH_APPLICATION_STORE, ensureConnectionEncryptionKey } from '@/core/connections/connection-store'
import { getConnectionCatalog, getOAuthClientSettings } from '@/core/connections/connection-catalog'
import { saveConnection } from '@/core/connections/connection-service'
import { setupConnection } from '@/core/connections/connection-tool'
import { OAUTH_MANAGER } from '@/core/connections/oauth-manager'

beforeEach(async () => {
  fixture.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-oauth-storage-'))
  fixture.key = ''
  fixture.settings = { client_id: 'fixture-client', client_secret: 'fixture-secret', unrelated: 'preserved' }
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await fs.rm(fixture.directory, { recursive: true, force: true })
})

it('migrates and verifies encrypted application credentials without exposing them in the catalog', async () => {
  await runWithProfileContext({ profileName: 'test' }, async () => {
    const catalog = await getConnectionCatalog()
    expect(catalog[0]!.methods[0]!.settings).toEqual({})
    expect(JSON.stringify(catalog)).not.toContain('fixture-secret')
    expect(fixture.settings).toEqual({ client_id: null, client_secret: null, unrelated: 'preserved' })
    expect(await getOAuthClientSettings('example.account')).toEqual({ client_id: 'fixture-client', client_secret: 'fixture-secret' })
    const stored = await fs.readFile(path.join(fixture.directory, 'test/connections/oauth-applications/example.account.json'), 'utf8')
    expect(stored).not.toContain('fixture-secret')
    expect(stored).not.toContain('fixture-client')
    expect(await CONNECTION_STORE.list('test')).toEqual([])
    expect(await OAUTH_APPLICATION_STORE.getCredentials('example.account', 'other')).toBeNull()

    fixture.key = ''
    await expect(ensureConnectionEncryptionKey('test')).rejects.toThrow('key is missing')
  })
})

it('preserves plaintext when the encrypted write fails', async () => {
  vi.spyOn(OAUTH_APPLICATION_STORE, 'save').mockRejectedValueOnce(new Error('Disk unavailable'))
  await runWithProfileContext({ profileName: 'test' }, async () => {
    await expect(getOAuthClientSettings('example.account')).rejects.toThrow('Disk unavailable')
    expect(fixture.settings['client_secret']).toBe('fixture-secret')
  })
})

it('saves new OAuth credentials encrypted and refreshes with the stored application secret', async () => {
  fixture.settings = { unrelated: 'preserved' }
  await runWithProfileContext({ profileName: 'test' }, async () => {
    const setup = await setupConnection({
      provider: 'example.account', method: 'oauth',
      credentials: { client_id: 'new-client', client_secret: 'new-secret' }
    })
    expect(setup).toContain('not connected yet')
    expect(setup).not.toContain('new-secret')
    expect(await CONNECTION_STORE.list()).toEqual([])
    await saveConnection({
      provider: 'example.account', auth_type: 'oauth',
      credentials: { client_id: 'new-client', client_secret: 'new-secret', access_token: 'access', refresh_token: 'refresh' }
    })
    expect(fixture.settings).toEqual({ unrelated: 'preserved' })
    expect(await getOAuthClientSettings('example.account')).toEqual({ client_id: 'new-client', client_secret: 'new-secret' })
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'next-access' }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const refreshed = await OAUTH_MANAGER.refreshCredentials('example.account', { access_token: 'access', refresh_token: 'refresh' })
    expect(refreshed['access_token']).toBe('next-access')
    expect(refreshed['client_secret']).toBeUndefined()
    expect(JSON.stringify(fetch.mock.calls)).toContain(Buffer.from('new-client:new-secret').toString('base64'))
  })
})
