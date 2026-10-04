import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { expect, it, vi } from 'vitest'

import { ConnectionStore } from '@/core/connections/connection-store'
import { getActiveProfileName, runWithProfileContext } from '@/core/profile-runtime/profile-context'
import { MODEL_ACCOUNT_STORE, connectFellow } from '@/core/llm-manager/llm-accounts'
import { discoverFellows } from '@/core/llm-manager/fellows/fellow-discovery'

const fixture = vi.hoisted(() => ({ directory: '' }))
vi.mock('@/config', () => ({
  CONFIG_MANAGER: {
    resolveSecretReference: (_reference: unknown, profile: string): string =>
      Buffer.alloc(32, profile === 'owner-a' ? 1 : 2).toString('base64'),
    getProviderBaseURL: (): string => 'https://old-proxy.example.invalid/v1',
    setValue: vi.fn()
  }
}))
vi.mock('@/core/config-states/config-state', () => ({
  CONFIG_STATE: { getModelState: (): { setUnifiedTarget: ReturnType<typeof vi.fn> } => ({ setUnifiedTarget: vi.fn() }) }
}))
vi.mock('@/core/profile-runtime/profile-paths', () => ({
  getProfilePaths: (profile = getActiveProfileName()): { root: string, connections: string } => ({
    root: path.join(fixture.directory, profile),
    connections: path.join(fixture.directory, profile, 'connections')
  })
}))
vi.mock('@/helpers/profile-helper', () => ({ ProfileHelper: {} }))

it.each([undefined, 'https://fellow.example.invalid/v1'])('binds an imported key to its fellow URL or provider default (%s)', async (baseUrl) => {
  fixture.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-fellow-account-test-'))
  const home = path.join(fixture.directory, 'fellow-home')
  const directory = path.join(home, '.pi', 'agent')
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(path.join(directory, 'auth.json'), JSON.stringify({
    openai: { type: 'api_key', key: 'test-key', baseUrl }
  }))
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: [] }))

  try {
    await runWithProfileContext({ profileName: 'owner-a' }, async () => {
      const discovery = await discoverFellows({ home, platform: process.platform, env: {} })
      const account = await connectFellow(discovery.connections[0]!)
      const expected = baseUrl || 'https://api.openai.com/v1'
      expect(fetch).toHaveBeenCalledWith(`${expected}/models`, expect.anything())
      expect((await MODEL_ACCOUNT_STORE.getCredentials(account.provider))?.['base_url']).toBe(expected)
    })
  } finally {
    fetch.mockRestore()
    await fs.rm(fixture.directory, { recursive: true, force: true })
  }
})

it('encrypts model accounts, isolates profiles and serializes token rotation', async () => {
  fixture.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-accounts-test-'))
  const refresh = vi.fn(async (id: string, credentials: Record<string, unknown>): Promise<Record<string, unknown>> => ({
    ...credentials, access_token: 'rotated-secret', expires_at: Date.now() + 3_600_000
  }))
  const store = new ConnectionStore('llm-accounts', refresh)

  try {
    await runWithProfileContext({ profileName: 'owner-a' }, async () => {
      await store.save({ provider: 'openai.test', auth_type: 'oauth',
        credentials: { access_token: 'original-secret', refresh_token: 'refresh-secret', expires_at: 1 } })
      const saved = await fs.readFile(path.join(fixture.directory, 'owner-a', 'connections', 'llm-accounts', 'openai.test.json'), 'utf8')
      expect(saved).not.toContain('original-secret')
      expect(saved).not.toContain('refresh-secret')
      expect((await store.getCredentials('openai.test', undefined, false, false))?.['access_token'])
        .toBe('original-secret')
      expect(refresh).not.toHaveBeenCalled()

      const reads = await Promise.all([store.getCredentials('openai.test'), store.getCredentials('openai.test')])
      expect(reads.map((credentials) => credentials?.['access_token'])).toEqual(['rotated-secret', 'rotated-secret'])
      expect(refresh).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(await store.list())).not.toContain('secret')
    })
    await runWithProfileContext({ profileName: 'owner-b' }, async () => {
      expect(await store.list()).toEqual([])
      expect(await store.getCredentials('openai.test')).toBeNull()
    })
  } finally {
    await fs.rm(fixture.directory, { recursive: true, force: true })
  }
})
