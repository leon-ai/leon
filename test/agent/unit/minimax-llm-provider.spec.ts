import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MiniMaxLLMProvider from '@/core/llm-manager/llm-providers/minimax-llm-provider'
import type { ResolvedLLMTarget } from '@/core/llm-manager/llm-routing'
import type { CompletionParams } from '@/core/llm-manager/types'
import { LLMDuties, LLMProviders } from '@/core/llm-manager/types'

vi.mock('@/config', () => ({
  CONFIG_MANAGER: {
    getProviderAPIKeyEnv: vi.fn(() => null),
    getProviderAPIKey: vi.fn(() => 'test-minimax-key'),
    getProviderBaseURL: vi.fn(
      () => process.env['TEST_MINIMAX_BASE_URL'] || ''
    )
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
    vi.stubEnv('TEST_MINIMAX_BASE_URL', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
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

  it('keeps MiniMax-M2.7 thinking enabled with Anthropic compatibility', () => {
    vi.stubEnv(
      'TEST_MINIMAX_BASE_URL',
      'https://api.minimax.io/anthropic'
    )
    const provider = createProvider('MiniMax-M2.7')
    const options = provider.buildCallOptions(
      'Answer directly.',
      createCompletionParams({ reasoningMode: 'off' })
    )

    expect(options['providerOptions']).toEqual({
      anthropic: {
        sendReasoning: true
      }
    })
  })

  it.each([
    {
      name: 'global OpenAI-compatible',
      baseURL: 'https://api.minimax.io/v1',
      expectedRequestURL: 'https://api.minimax.io/v1/chat/completions',
      flavor: 'openai-compatible'
    },
    {
      name: 'China OpenAI-compatible',
      baseURL: 'https://api.minimaxi.com/v1',
      expectedRequestURL: 'https://api.minimaxi.com/v1/chat/completions',
      flavor: 'openai-compatible'
    },
    {
      name: 'global Anthropic-compatible',
      baseURL: 'https://api.minimax.io/anthropic',
      expectedRequestURL: 'https://api.minimax.io/anthropic/v1/messages',
      flavor: 'anthropic'
    },
    {
      name: 'China Anthropic-compatible',
      baseURL: 'https://api.minimaxi.com/anthropic',
      expectedRequestURL: 'https://api.minimaxi.com/anthropic/v1/messages',
      flavor: 'anthropic'
    }
  ])('sends a valid request to the $name endpoint', async ({
    baseURL,
    expectedRequestURL,
    flavor
  }) => {
    vi.stubEnv('TEST_MINIMAX_BASE_URL', baseURL)
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        void input
        void init

        return new Response(
          JSON.stringify(
            flavor === 'anthropic'
              ? {
                  id: 'msg-test',
                  type: 'message',
                  role: 'assistant',
                  model: 'MiniMax-M3',
                  content: [{ type: 'text', text: 'Done.' }],
                  stop_reason: 'end_turn',
                  stop_sequence: null,
                  usage: {
                    input_tokens: 1,
                    output_tokens: 1
                  }
                }
              : {
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
                }
          ),
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
      createCompletionParams({
        reasoningMode: flavor === 'anthropic' ? 'on' : 'off'
      })
    )

    const [requestURL, requestInit] = fetchMock.mock.calls[0]!
    const requestBody = JSON.parse(String(requestInit?.body)) as Record<
      string,
      unknown
    >

    expect(String(requestURL)).toBe(expectedRequestURL)
    expect(requestBody['thinking']).toEqual({
      type: flavor === 'anthropic' ? 'adaptive' : 'disabled'
    })
    expect(requestBody['reasoning_split']).toBe(
      flavor === 'openai-compatible' ? true : undefined
    )
    expect(requestBody['reasoning_effort']).toBeUndefined()
  })
})
