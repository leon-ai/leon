import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MiniMaxLLMProvider from '@/core/llm-manager/llm-providers/minimax-llm-provider'
import type { ResolvedLLMTarget } from '@/core/llm-manager/llm-routing'
import type { CompletionParams } from '@/core/llm-manager/types'
import { LLMDuties, LLMProviders } from '@/core/llm-manager/types'

vi.mock('@/config', () => ({
  CONFIG_MANAGER: {
    getProviderAPIKeyEnv: vi.fn(() => null)
  }
}))

vi.mock('@/helpers/log-helper', () => ({
  LogHelper: {
    title: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    warning: vi.fn(),
    error: vi.fn()
  }
}))

interface ProviderWithPrivateCallOptions {
  buildCallOptions(
    prompt: string,
    completionParams: CompletionParams
  ): Record<string, unknown>
}

type TestProvider = MiniMaxLLMProvider & ProviderWithPrivateCallOptions

function createProvider(model: string): TestProvider {
  const target: ResolvedLLMTarget = {
    provider: LLMProviders.MiniMax,
    model,
    label: `minimax/${model}`,
    isLocal: false,
    isEnabled: true,
    isResolved: true
  }

  return new MiniMaxLLMProvider(target) as TestProvider
}

function createCompletionParams(
  overrides: Partial<CompletionParams> = {}
): CompletionParams {
  return {
    dutyType: LLMDuties.ReAct,
    systemPrompt: 'Plan the next step.',
    ...overrides
  }
}

describe('MiniMaxLLMProvider', () => {
  beforeEach(() => {
    vi.stubEnv('LEON_MINIMAX_API_KEY', 'test-minimax-key')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses adaptive thinking and separated reasoning for MiniMax-M3', () => {
    const provider = createProvider('MiniMax-M3')
    const options = provider.buildCallOptions(
      'Answer normally.',
      createCompletionParams({ reasoningMode: 'on' })
    )

    expect(options['providerOptions']).toEqual({
      minimax: {
        reasoning_split: true,
        thinking: { type: 'adaptive' }
      }
    })
  })

  it('disables MiniMax-M3 thinking when requested', () => {
    const provider = createProvider('MiniMax-M3')
    const options = provider.buildCallOptions(
      'Answer directly.',
      createCompletionParams({ reasoningMode: 'off' })
    )

    expect(options['providerOptions']).toEqual({
      minimax: {
        reasoning_split: true,
        thinking: { type: 'disabled' }
      }
    })
  })

  it('keeps MiniMax-M2.7 thinking enabled', () => {
    const provider = createProvider('MiniMax-M2.7')
    const options = provider.buildCallOptions(
      'Answer directly.',
      createCompletionParams({ reasoningMode: 'off' })
    )

    expect(options['providerOptions']).toEqual({
      minimax: {
        reasoning_split: true
      }
    })
  })

  it('sends the documented request fields to the OpenAI-compatible endpoint', async () => {
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        void input
        void init

        return new Response(
          JSON.stringify({
            id: 'chatcmpl-test',
            created: 0,
            model: 'MiniMax-M3',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: 'Done.'
                },
                finish_reason: 'stop'
              }
            ],
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
              total_tokens: 2
            }
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      }
    )
    vi.stubGlobal('fetch', fetchMock)
    const provider = createProvider('MiniMax-M3')

    await provider.runChatCompletion(
      'Answer directly.',
      createCompletionParams({ reasoningMode: 'off' })
    )

    const [requestURL, requestInit] = fetchMock.mock.calls[0]!
    const requestBody = JSON.parse(String(requestInit?.body)) as Record<
      string,
      unknown
    >

    expect(String(requestURL)).toBe(
      'https://api.minimax.io/v1/chat/completions'
    )
    expect(requestBody['thinking']).toEqual({ type: 'disabled' })
    expect(requestBody['reasoning_split']).toBe(true)
    expect(requestBody['reasoning_effort']).toBeUndefined()
  })
})
