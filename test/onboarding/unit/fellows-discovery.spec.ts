import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FELLOWS, getFellowDirectory } from '@/core/llm-manager/fellows/fellow-catalog'
import { discoverFellows, FellowAuthType, readFellowAPIKey } from '@/core/llm-manager/fellows/fellow-discovery'

const directories: string[] = []
const cli = vi.hoisted(() => ({ status: vi.fn() }))
vi.mock('execa', () => ({ default: cli.status }))

beforeEach(() => {
  cli.status.mockResolvedValue({ exitCode: 1, stdout: '', stderr: '' })
})

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

describe('fellow discovery', () => {
  it('reads real stores, deduplicates keys, orders subscriptions first, and keeps secrets private', async () => {
    cli.status.mockResolvedValue({ exitCode: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }) })
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-fellows-'))
    directories.push(home)
    const files = {
      '.claude/.credentials.json': JSON.stringify({ claudeAiOauth: { accessToken: 'private-claude-token' } }),
      '.claude/settings.json': JSON.stringify({ env: { ANTHROPIC_API_KEY: 'sk-ant-oat-test-subscription' } }),
      '.codex/auth.json': JSON.stringify({ tokens: { access_token: 'private-token' } }),
      '.codex/config.toml': 'model = "gpt-6.1-sol"\n',
      '.pi/agent/auth.json': JSON.stringify({ openai: { type: 'api_key', key: 'private-shared-key' } }),
      '.pi/agent/settings.json': JSON.stringify({ defaultModel: 'gpt-6.1-sol' }),
      '.hermes/.env': 'OPENAI_API_KEY=private-shared-key\nOPENROUTER_API_KEY=private-router-key\n',
      '.hermes/config.yaml': 'model: gpt-6.1-sol\n',
      '.local/share/opencode/auth.json': '{ broken'
    }
    for (const [relative, content] of Object.entries(files)) {
      const file = path.join(home, relative)
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, content)
    }

    const discovery = await discoverFellows({ home, platform: process.platform, env: {} })
    expect(discovery.connections[0]?.authType).toBe(FellowAuthType.ChatGPT)
    const key = discovery.connections.find((connection) => connection.provider === 'openai' && connection.authType === FellowAuthType.APIKey)!
    expect(key.sources).toEqual(expect.arrayContaining(['Pi', 'Hermes Agent']))
    expect(await readFellowAPIKey(key)).toBe('private-shared-key')
    expect(JSON.stringify(discovery)).not.toContain('private-')
    expect(JSON.stringify(discovery)).not.toContain('sk-ant-oat-test-subscription')
    expect(discovery.connections.filter((connection) => connection.provider === 'anthropic'))
      .toEqual([expect.objectContaining({ authType: FellowAuthType.ClaudeCode })])
    expect(discovery.issues).toHaveLength(1)
  })

  it('requires a confirmed Claude Code login instead of trusting stored subscription tokens', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-claude-fellows-'))
    directories.push(home)
    await fs.mkdir(path.join(home, '.claude'), { recursive: true })
    await fs.mkdir(path.join(home, '.pi', 'agent'), { recursive: true })
    await fs.writeFile(path.join(home, '.claude', '.credentials.json'), JSON.stringify({
      claudeAiOauth: { accessToken: 'stale-test-token' }
    }))
    await fs.writeFile(path.join(home, '.pi', 'agent', 'auth.json'), JSON.stringify({
      anthropic: { type: 'oauth', access: 'private-pi-token', refresh: 'private-refresh' }
    }))

    const environment = { home, platform: process.platform, env: {} }
    expect((await discoverFellows(environment)).connections).toEqual([])
    cli.status.mockResolvedValue({ exitCode: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'api_key' }) })
    expect((await discoverFellows(environment)).connections).toEqual([])
    cli.status.mockResolvedValue({ exitCode: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }) })
    expect((await discoverFellows(environment)).connections).toEqual([
      expect.objectContaining({ authType: FellowAuthType.ClaudeCode, sources: ['Claude Code'] })
    ])
  })

  it.each(['linux', 'darwin', 'win32'] as const)('resolves %s home paths and custom roots', (platform) => {
    const home = platform === 'win32' ? 'C:\\Users\\owner' : '/users/owner'
    const join = platform === 'win32' ? path.win32.join : path.join
    const codex = FELLOWS.find((fellow) => fellow.id === 'codex')!
    expect(getFellowDirectory(codex, { home, platform, env: {} })).toBe(join(home, '.codex'))
    const opencode = FELLOWS.find((fellow) => fellow.id === 'opencode')!
    expect(getFellowDirectory(opencode, { home, platform, env: {} }))
      .toBe(join(home, '.local', 'share', 'opencode'))
    expect(getFellowDirectory(opencode, { home, platform, env: { XDG_CONFIG_HOME: join(home, 'settings') } }, true))
      .toBe(join(home, 'settings', 'opencode'))
    const custom = join(home, 'custom-codex')
    expect(getFellowDirectory(codex, { home, platform, env: { CODEX_HOME: custom } })).toBe(custom)
  })

  it('accepts an empty machine without creating any files', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-no-fellows-'))
    directories.push(home)
    expect(await discoverFellows({ home, platform: process.platform, env: {} }))
      .toEqual({ fellows: [], connections: [], issues: [] })
    expect(await fs.readdir(home)).toEqual([])
  })

  it('reads current OpenClaw SQLite profiles and keeps another provider model separate', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-claw-fellows-'))
    directories.push(home)
    const root = path.join(home, '.openclaw')
    await fs.mkdir(path.join(root, 'state'), { recursive: true })
    await fs.writeFile(path.join(root, 'openclaw.json'), `{
      agents: { defaults: { model: { primary: 'openrouter/anthropic/claude-sonnet-5' } } },
    }`)
    const file = path.join(root, 'state', 'openclaw.sqlite')
    const database = new Database(file)
    database.exec('CREATE TABLE config_machine_state (state_key TEXT, value_json TEXT)')
    database.prepare('INSERT INTO config_machine_state VALUES (?, ?)').run('authProfiles.store', JSON.stringify({
      profiles: {
        'router:owner': { type: 'api_key', provider: 'openrouter', key: 'test-router-key' },
        'openai:owner': { type: 'api_key', provider: 'openai', key: 'test-openai-key' }
      }
    }))
    database.close()
    const before = await fs.readFile(file)

    const discovery = await discoverFellows({ home, platform: process.platform, env: {} })
    expect(discovery.connections).toHaveLength(2)
    expect(discovery.connections.find((connection) => connection.provider === 'openrouter')?.model)
      .toBe('anthropic/claude-sonnet-5')
    expect(discovery.connections.find((connection) => connection.provider === 'openai')?.model)
      .not.toBe('openrouter/anthropic/claude-sonnet-5')
    expect(await fs.readFile(file)).toEqual(before)
    expect(JSON.stringify(discovery)).not.toContain('test-router-key')
  })
})
