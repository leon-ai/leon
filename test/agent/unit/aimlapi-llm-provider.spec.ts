import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AIMLAPILLMProvider, {
  buildAIMLAPIHeaders
} from '@/core/llm-manager/llm-providers/aimlapi-llm-provider'
import type { ResolvedLLMTarget } from '@/core/llm-manager/llm-routing'
import type { CompletionParams } from '@/core/llm-manager/types'
import { LLMDuties, LLMProviders } from '@/core/llm-manager/types'

vi.mock('@/config', () => ({
  CONFIG_MANAGER: {
    getProviderAPIKeyEnv: vi.fn(() => null),
    getProviderAPIKey: vi.fn(() => 'test-aimlapi-key'),
    getProviderBaseURL: vi.fn(() => process.env['TEST_AIMLAPI_BASE_URL'] || '')
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

/**
 * The partner id is never validated at request time: the gateway silently
 * treats a malformed one as untagged usage, so only this assertion catches
 * a typo.
 */
const PARTNER_ID_PATTERN = /^part_[A-Za-z0-9]{1,64}$/

interface ProviderWithPrivateCallOptions {
  buildCallOptions(
    prompt: string,
    completionParams: CompletionParams
  ): Record<string, unknown>
  runChatCompletion(
    prompt: string,
    completionParams: CompletionParams
  ): Promise<{ data: Record<string, unknown> }>
}

type TestProvider = AIMLAPILLMProvider & ProviderWithPrivateCallOptions

function createProvider(model = 'openai/gpt-5.6-sol'): TestProvider {
  const target: ResolvedLLMTarget = {
    provider: LLMProviders.AIMLAPI,
    model,
    label: `aimlapi/${model}`,
    isLocal: false,
    isEnabled: true,
    isResolved: true
  }

  return new AIMLAPILLMProvider(target) as TestProvider
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

function stubChatCompletionFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () =>
    new Response(
      JSON.stringify({
        id: 'chatcmpl-test',
        created: 0,
        model: 'openai/gpt-5.6-sol',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Done.' },
            finish_reason: 'stop'
          }
        ],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  )

  vi.stubGlobal('fetch', fetchMock)

  return fetchMock
}

function readRequestHeaders(init: RequestInit | undefined): Record<
  string,
  string
> {
  return Object.fromEntries(
    Object.entries(
      (init?.headers || {}) as Record<string, string | undefined>
    )
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key.toLowerCase(), String(value)])
  )
}

describe('AIMLAPILLMProvider', () => {
  beforeEach(() => {
    vi.stubEnv('LEON_AIMLAPI_API_KEY', 'test-aimlapi-key')
    vi.stubEnv('TEST_AIMLAPI_BASE_URL', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('calls the OpenAI-compatible chat completions endpoint', async () => {
    const fetchMock = stubChatCompletionFetch()
    const provider = createProvider()

    await provider.runChatCompletion('Answer directly.', createCompletionParams())

    const [requestURL] = fetchMock.mock.calls[0]!

    expect(String(requestURL)).toBe(
      'https://api.aimlapi.com/v1/chat/completions'
    )
  })

  it('omits unset optional parameters instead of sending them as null', async () => {
    const fetchMock = stubChatCompletionFetch()
    const provider = createProvider()

    await provider.runChatCompletion('Answer directly.', createCompletionParams())

    const [, requestInit] = fetchMock.mock.calls[0]!
    const requestBody = JSON.parse(String(requestInit?.body)) as Record<
      string,
      unknown
    >

    /**
     * The gateway answers HTTP 400 for a null-valued optional field, so an
     * unset parameter has to be absent from the payload. Serialising it as
     * null fails every real call while leaving a mocked suite green.
     */
    for (const field of [
      'temperature',
      'top_p',
      'seed',
      'reasoning_effort',
      'tools',
      'tool_choice',
      'response_format',
      'max_tokens',
      'stream'
    ]) {
      expect(requestBody[field]).not.toBeNull()
    }

    expect(Object.entries(requestBody).filter(([, value]) => value === null))
      .toEqual([])
  })

  it('forwards deterministic generation options when they are set', async () => {
    const fetchMock = stubChatCompletionFetch()
    const provider = createProvider()

    await provider.runChatCompletion(
      'Answer directly.',
      createCompletionParams({ temperature: 0, seed: 7, maxTokens: 64 })
    )

    const [, requestInit] = fetchMock.mock.calls[0]!
    const requestBody = JSON.parse(String(requestInit?.body)) as Record<
      string,
      unknown
    >

    expect(requestBody['temperature']).toBe(0)
    expect(requestBody['seed']).toBe(7)
    expect(requestBody['max_tokens']).toBe(64)
  })

  it('sends the attribution headers on official endpoint requests', async () => {
    const fetchMock = stubChatCompletionFetch()
    const provider = createProvider()

    await provider.runChatCompletion('Answer directly.', createCompletionParams())

    const [, requestInit] = fetchMock.mock.calls[0]!
    const headers = readRequestHeaders(requestInit)

    expect(headers['http-referer']).toBe('https://github.com/leon-ai/leon')
    expect(headers['x-title']).toBe('Leon')
    expect(headers['x-aimlapi-source']).toBe('agent/leon')
    expect(headers['x-aimlapi-partner-id']).toBe('part_lcAMsJBHJpF6eW4JFtT3pJfW')
    expect(headers['x-aimlapi-partner-id']).toMatch(PARTNER_ID_PATTERN)
  })

  it('keeps attribution off a Base URL that is not the official host', async () => {
    vi.stubEnv('TEST_AIMLAPI_BASE_URL', 'https://gateway.example.com/v1')
    const fetchMock = stubChatCompletionFetch()
    const provider = createProvider()

    await provider.runChatCompletion('Answer directly.', createCompletionParams())

    const [requestURL, requestInit] = fetchMock.mock.calls[0]!
    const headers = readRequestHeaders(requestInit)

    expect(String(requestURL)).toBe(
      'https://gateway.example.com/v1/chat/completions'
    )
    expect(headers['x-aimlapi-partner-id']).toBeUndefined()
    expect(headers['x-aimlapi-source']).toBeUndefined()
    expect(headers['http-referer']).toBeUndefined()
    expect(headers['x-title']).toBeUndefined()
  })

  it('builds a new header object per request and rejects invalid Base URLs', () => {
    const first = buildAIMLAPIHeaders('https://api.aimlapi.com/v1')
    const second = buildAIMLAPIHeaders('https://api.aimlapi.com/v1')

    first['X-AIMLAPI-Partner-ID'] = 'part_mutated'

    expect(second['X-AIMLAPI-Partner-ID']).toBe('part_lcAMsJBHJpF6eW4JFtT3pJfW')
    expect(buildAIMLAPIHeaders('not-a-url')).toEqual({})
    expect(buildAIMLAPIHeaders('https://api.aimlapi.com.evil.test/v1'))
      .toEqual({})
  })
})
