import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConnectionCommand } from '@/built-in-command/commands/connection-command/connection-command'
import type {
  BuiltInCommandExecutionContext,
  BuiltInCommandExecutionResult,
  BuiltInCommandSession
} from '@/built-in-command/built-in-command'
import { getActiveProfileName, runWithProfileContext } from '@/core/profile-runtime/profile-context'
import {
  getActiveConversationSessionModelTarget,
  runWithConversationSession
} from '@/core/session-manager/session-context'

const runtime = vi.hoisted(() => ({
  signIn: vi.fn(), providerInit: vi.fn(), managerInit: vi.fn(),
  list: vi.fn(), tools: vi.fn(), credentials: vi.fn(), save: vi.fn(), use: vi.fn()
}))

vi.mock('@/config', () => ({ CONFIG_MANAGER: { getProviderConfig: (): null => null } }))
vi.mock('@/core/config-states/config-state', () => ({ CONFIG_STATE: {} }))
vi.mock('@/core/profile-runtime/profile-runtime-manager', () => ({ PROFILE_RUNTIME_MANAGER: {} }))
vi.mock('@/helpers/log-helper', () => ({ LogHelper: { warning: vi.fn() } }))
vi.mock('@/helpers/profile-helper', () => ({ ProfileHelper: {} }))
vi.mock('@/core/connections/connection-store', () => ({ CONNECTION_STORE: { list: runtime.tools } }))
vi.mock('@/core/llm-manager/llm-accounts', () => ({
  MODEL_ACCOUNT_STORE: { list: runtime.list, getCredentials: runtime.credentials, save: runtime.save },
  connectFellow: vi.fn(), useModelAccount: runtime.use, unlinkModelAccount: vi.fn(),
  startModelAccountSignIn: runtime.signIn
}))

beforeEach(() => {
  runtime.list.mockResolvedValue([])
  runtime.tools.mockResolvedValue([])
})
vi.mock('@/core', () => ({
  LLM_PROVIDER: { init: runtime.providerInit },
  LLM_MANAGER: { init: runtime.managerInit }
}))

async function executeAICommand(
  action: string,
  value: string
): Promise<BuiltInCommandExecutionResult> {
  return new ConnectionCommand().execute({
    args: ['ai', action, value]
  } as unknown as BuiltInCommandExecutionContext)
}

describe('Connection commands', () => {
  it('lists AI and tool metadata without reading credentials', async () => {
    runtime.list.mockResolvedValue([{ provider: 'openai.test', account_label: 'ChatGPT', status: 'connected' }])
    runtime.tools.mockResolvedValue([{ provider: 'music_audio.spotify', account_label: 'Spotify owner', status: 'connected' }])
    const response = await new ConnectionCommand().execute({ args: [] } as unknown as BuiltInCommandExecutionContext)
    expect(response.result.plain_text.join(' ')).toContain('AI · ChatGPT')
    expect(response.result.plain_text.join(' ')).toContain('Tool · Spotify owner')
    expect(runtime.credentials).not.toHaveBeenCalled()
  })

  it('uses exact autocomplete usage and rejects values for discovery', async () => {
    const command = new ConnectionCommand()
    const suggestions = command.getAutocompleteItems({
      raw_input: '/connection ai', args: ['ai'], ends_with_space: false
    })
    expect(suggestions.map((item) => item.name)).toEqual([
      'discover', 'connect', 'use', 'disconnect'
    ])
    expect(command.getAutocompleteItems({
      raw_input: '/connection ai ', args: ['ai'], ends_with_space: true
    })).toEqual(suggestions)
    expect(command.getAutocompleteItems({
      raw_input: '/connection a', args: ['a'], ends_with_space: false
    }).map((item) => item.value)).toEqual(['/connection ai'])
    expect(suggestions.find((item) => item.name === 'discover')?.usage).toBe('/connection ai discover')
    expect(suggestions.find((item) => item.name === 'use')?.usage).toBe('/connection ai use <connection>')
    const response = await command.execute({
      args: ['ai', 'discover', 'unused']
    } as unknown as BuiltInCommandExecutionContext)
    expect(response.status).toBe('error')
  })

  it.each(['openai', 'openrouter'])('replaces a saved %s API key through the password prompt', async (provider) => {
    const id = `${provider}.test-key`
    const credentials = { auth_kind: 'api_key', api_key: 'old-test-key', model: 'test-model', base_url: 'https://fellow.example.invalid/v1' }
    runtime.list.mockResolvedValue([{ provider: id, auth_type: 'api_key', account_label: 'Pi' }])
    runtime.credentials.mockResolvedValue(credentials)
    const response = await executeAICommand('connect', id)
    expect(response.status).toBe('awaiting_required_parameters')
    expect(response.session?.pending_input?.type).toBe('password')
    expect(runtime.signIn).not.toHaveBeenCalled()

    const updated = await new ConnectionCommand().executePendingInput({
      input: 'new-test-key', session: response.session as BuiltInCommandSession, resolveCommands: () => []
    })
    expect(updated.status).toBe('completed')
    expect(runtime.save).toHaveBeenCalledWith(expect.objectContaining({
      provider: id, credentials: { ...credentials, api_key: 'new-test-key' }
    }))
    expect(runtime.use).toHaveBeenCalledWith(id)
    expect(JSON.stringify(updated)).not.toContain('new-test-key')
  })

  it.each([
    { provider: 'openai', auth_kind: 'chatgpt' },
    { provider: 'openrouter', auth_kind: 'openrouter' }
  ])('reconnects a saved $provider browser account through its own sign-in', async ({ provider, auth_kind }) => {
    const id = `${provider}.browser`
    runtime.list.mockResolvedValue([{ provider: id }])
    runtime.credentials.mockResolvedValue({ auth_kind })
    runtime.signIn.mockResolvedValue({ url: 'https://example.invalid/sign-in', complete: new Promise(() => {}) })
    expect((await executeAICommand('connect', id)).status).toBe('completed')
    expect(runtime.signIn).toHaveBeenCalledWith(provider, id)
    expect(runtime.credentials).toHaveBeenCalledWith(id, undefined, false, false)
  })

  it('guides a saved Claude Code connection back to its own login', async () => {
    const id = 'anthropic.claude-login'
    runtime.list.mockResolvedValue([{ provider: id }])
    runtime.credentials.mockResolvedValue({ auth_kind: 'claude_code', config_directory: '/test/claude-login' })
    const response = await executeAICommand('connect', id)
    expect(response.result.plain_text.join(' ')).toContain(`claude auth login, then run /connection ai use ${id}`)
    expect(runtime.signIn).not.toHaveBeenCalled()
  })

  it('reloads the original profile after browser sign-in, without the session model override', async () => {
    let finishSignIn!: () => void
    runtime.signIn.mockResolvedValue({
      url: 'https://example.invalid/sign-in',
      complete: new Promise<void>((resolve) => {
        finishSignIn = resolve
      })
    })
    runtime.providerInit.mockImplementation(async () => {
      expect(getActiveProfileName()).toBe('sign-in-owner')
      expect(getActiveConversationSessionModelTarget()).toBeNull()
      return true
    })

    const response = await runWithProfileContext({ profileName: 'sign-in-owner' }, () =>
      runWithConversationSession({ sessionId: 'test-session', modelTarget: 'openai/session-model' }, () =>
        executeAICommand('connect', 'openai')
      )
    )
    expect(response.status).toBe('completed')
    expect(runtime.providerInit).not.toHaveBeenCalled()

    await runWithProfileContext({ profileName: 'another-owner' }, async () => {
      finishSignIn()
      await vi.waitFor(() => expect(runtime.managerInit).toHaveBeenCalledOnce())
    })
    expect(runtime.providerInit).toHaveBeenCalledOnce()
  })
})
