import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import setupPreferences from '@@/scripts/setup/setup-preferences'
import * as fellowDiscovery from '@/core/llm-manager/fellows/fellow-discovery'
import { FellowAuthType, type FellowConnection } from '@/core/llm-manager/fellows/fellow-discovery'
import { LLMProviders } from '@/core/llm-manager/types'

const setup = vi.hoisted(() => ({
  fellows: vi.fn(), remote: vi.fn(), prompt: vi.fn(), info: vi.fn(), account: vi.fn()
}))
vi.mock('@@/scripts/setup/setup-fellows', () => ({
  default: setup.fellows, setupModelAccount: setup.account
}))
vi.mock('@@/scripts/setup/setup-remote-llm', () => ({ default: setup.remote }))
vi.mock('@@/scripts/setup/setup-ui', () => ({
  SetupUI: { info: setup.info }, setupConsola: { prompt: setup.prompt }
}))
vi.mock('@@/scripts/setup/setup-status', () => ({
  createSetupStatus: (): { start: () => { succeed: ReturnType<typeof vi.fn> } } => ({
    start: () => ({ succeed: vi.fn() })
  })
}))

const capability = { canInstallLocalAI: true }
const existing = { hasResolvedChoice: false, setupLocalAI: false, targetType: 'defaultLocal' }
const installed = { isInstalled: false }
const inputTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
const outputTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')

beforeAll(() => {
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
})
afterAll(() => {
  for (const [stream, descriptor] of [[process.stdin, inputTTY], [process.stdout, outputTTY]] as const) {
    if (descriptor) {
      Object.defineProperty(stream, 'isTTY', descriptor)
    } else {
      delete stream.isTTY
    }
  }
})

describe('setup preferences', () => {
  it('offers one connection per provider and method while retaining the full discovery', async () => {
    const connection = (
      id: string,
      provider: LLMProviders,
      authType: FellowAuthType,
      source: string
    ): FellowConnection => ({ id, provider, authType, sources: [source], model: 'test-model' })
    const connections = [
      connection('codex-chatgpt', LLMProviders.OpenAI, FellowAuthType.ChatGPT, 'Codex'),
      connection('hermes-chatgpt', LLMProviders.OpenAI, FellowAuthType.ChatGPT, 'Hermes Agent'),
      connection('claw-openai', LLMProviders.OpenAI, FellowAuthType.APIKey, 'OpenClaw'),
      connection('code-openai', LLMProviders.OpenAI, FellowAuthType.APIKey, 'OpenCode'),
      connection('claw-router', LLMProviders.OpenRouter, FellowAuthType.APIKey, 'OpenClaw'),
      connection('code-router', LLMProviders.OpenRouter, FellowAuthType.APIKey, 'OpenCode'),
      connection('hermes-deepseek', LLMProviders.DeepSeek, FellowAuthType.APIKey, 'Hermes Agent'),
      connection('claw-zai', LLMProviders.ZAI, FellowAuthType.APIKey, 'OpenClaw')
    ]
    vi.spyOn(fellowDiscovery, 'discoverFellows').mockResolvedValue({
      fellows: ['Codex', 'Hermes Agent', 'OpenClaw', 'OpenCode'], connections, issues: []
    })
    setup.prompt.mockResolvedValueOnce('continue')
    const { default: setupFellows } = await vi.importActual<{ default: () => Promise<null> }>(
      '@@/scripts/setup/setup-fellows'
    )

    expect(await setupFellows()).toBeNull()
    const options = setup.prompt.mock.calls[0]![1].options as { label: string, value: string }[]
    expect(options.map((option) => option.label)).toEqual([
      'Bind with my ChatGPT account',
      'Reuse my OpenAI API key from OpenClaw',
      'Reuse my OpenRouter API key from OpenClaw',
      'Reuse my DeepSeek API key from Hermes Agent',
      'Reuse my Z.ai API key from OpenClaw',
      'Continue without these connections'
    ])
    expect(options[0]?.value).toBe('codex-chatgpt')
    expect(connections).toHaveLength(8)
  })

  it('discovers fellows first and skips manual/local questions after selection', async () => {
    setup.fellows.mockResolvedValueOnce({ fellowAccount: 'openai.example' })
    const preferences = await setupPreferences(capability, existing, installed)

    expect(preferences.fellowAccount).toBe('openai.example')
    expect(preferences.setupLocalAI).toBe(false)
    expect(preferences.setupVoice).toBe(false)
    expect(setup.prompt).not.toHaveBeenCalled()
    expect(setup.remote).not.toHaveBeenCalled()
  })

  it('keeps the existing local question with No as default when no fellow is selected', async () => {
    setup.fellows.mockResolvedValueOnce(null)
    setup.prompt.mockResolvedValueOnce(false)
    setup.remote.mockResolvedValueOnce({ remoteLLMProvider: 'openai', remoteLLMModel: 'example' })
    const preferences = await setupPreferences(capability, existing, installed)

    expect(setup.prompt).toHaveBeenCalledExactlyOnceWith('Do you want me to set up local AI now?', {
      type: 'confirm', initial: false, cancel: 'default'
    })
    expect(setup.fellows.mock.invocationCallOrder.at(-1))
      .toBeLessThan(setup.prompt.mock.invocationCallOrder.at(-1)!)
    expect(preferences.remoteLLMProvider).toBe('openai')
    expect(preferences.setupVoice).toBe(false)
  })

  it('links OpenRouter in manual setup without asking for a model or key', async () => {
    const { default: setupRemoteLLM } = await vi.importActual<{
      default: () => Promise<{ fellowAccount: string }>
    }>('@@/scripts/setup/setup-remote-llm')
    setup.prompt.mockResolvedValueOnce('openrouter').mockResolvedValueOnce('account')
    setup.account.mockResolvedValueOnce({ fellowAccount: 'openrouter.example' })

    expect(await setupRemoteLLM()).toEqual({ fellowAccount: 'openrouter.example' })
    expect(setup.prompt).toHaveBeenCalledTimes(2)
    expect(setup.account).toHaveBeenCalledExactlyOnceWith('openrouter')
  })
})
