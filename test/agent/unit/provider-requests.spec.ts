import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LLMProviders } from '@/core/llm-manager/types'
import { PROVIDER_REQUESTS, requestProvider } from '@/core/llm-manager/provider-requests'
import { mediaEndpoint } from '@/core/llm-manager/media-generation/media-generation-transport'
import HostedTool from '@@/tools/search_web/hosted/src/nodejs/hosted-tool'

const mocks = vi.hoisted(() => ({
  credentials: vi.fn(),
  fetch: vi.fn(),
  create: vi.fn(),
  close: vi.fn()
}))

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()

  return {
    ...actual,
    CONFIG_MANAGER: new Proxy(actual.CONFIG_MANAGER, {
      get: (target, property): unknown => {
        if (property === 'getProviderAPIKey') {
          return (): string => 'spare-key'
        }
        if (property === 'getProviderBaseURL' || property === 'getProviderGenerationBaseURL') {
          return (): null => null
        }

        return Reflect.get(target, property)
      }
    })
  }
})
vi.mock('@/core/llm-manager/llm-accounts', () => ({
  getModelAccountCredentials: mocks.credentials,
  MODEL_ACCOUNT_STORE: {
    getCredentials: mocks.credentials,
    markNeedsAttention: vi.fn()
  }
}))
vi.mock('@/core/config-states/config-state', () => ({
  CONFIG_STATE: {
    getModelSettingsState: (): object => ({
      getSettings: (): object => ({ reasoning: 'medium', speed: 'fast' })
    })
  }
}))
vi.mock('@vercel/ai-sdk-openai-websocket-fetch', () => ({
  createWebSocketFetch: mocks.create
}))
vi.mock('@sdk/toolkit-config', () => ({
  ToolkitConfig: {
    load: (): object => ({ description: 'Hosted search' }),
    loadToolSettings: (): object => ({})
  }
}))

function responseStream(event: Record<string, unknown>): Response {
  return new Response(`data: ${JSON.stringify(event)}\n\n`, {
    headers: { 'content-type': 'text/event-stream' }
  })
}

describe('profile provider requests', () => {
  beforeEach(() => {
    mocks.credentials.mockResolvedValue({
      auth_kind: 'chatgpt', account_id: 'bound-account', access_token: 'account-token'
    })
    mocks.create.mockImplementation(() => Object.assign(mocks.fetch, { close: mocks.close }))
  })

  afterEach(() => {
    PROVIDER_REQUESTS.close()
  })

  it('reads hosted URLs through Core with the bound account and preserves native evidence', async () => {
    const url = 'https://example.com/weather'
    const output = [
      { type: 'web_search_call', status: 'completed', action: { type: 'open_page', url } },
      {
        type: 'message', content: [{
          type: 'output_text', text: 'A complete forecast.',
          annotations: [{ type: 'url_citation', url }]
        }]
      }
    ]
    mocks.fetch.mockImplementation(async () => new Response([
      ...output.map((item, index) => `data: ${JSON.stringify({
        type: 'response.output_item.done', output_index: index, item
      })}\n\n`),
      `data: ${JSON.stringify({ type: 'response.completed',
        response: { status: 'completed', output: [] } })}\n\n`
    ].join(''), { headers: { 'content-type': 'text/event-stream' } }))
    const coreFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(new Headers(init?.headers).get('x-leon-profile-token')).toBe('profile-token')
      if (String(input).includes('/target')) {
        return Response.json({ provider: 'openai', model: 'gpt-6', currentDateTime: '2026-10-05' })
      }
      const request = JSON.parse(String(init?.body))

      return requestProvider(request.provider, request.endpoint, request.payload, {
        headers: request.headers
      })
    })
    const tool = new HostedTool()
    await tool.prepareExecution({
      toolkitId: 'search_web', toolId: 'hosted', functionName: 'fetchUrl',
      parameters: { url }, profileName: 'test', conversationSessionId: null,
      leonService: { baseURL: 'http://localhost/api/v1', token: 'profile-token' }
    })

    const result = await tool.fetchUrl(url)
    expect(result.content).toBe('A complete forecast.')
    expect(result.provider).toBe('openai')
    expect(coreFetch).toHaveBeenCalledTimes(2)
    const init = mocks.fetch.mock.calls[0]![1] as RequestInit
    const body = JSON.parse(String(init.body))
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer account-token')
    expect(body).toMatchObject({
      model: 'gpt-6', store: false, stream: true,
      reasoning: { effort: 'medium' }, service_tier: 'priority'
    })
    expect(body.include).toContain('reasoning.encrypted_content')
    expect(body.tools[0].type).toBe('web_search')

    // Built-in media output must survive the same collector and reuse its socket.
    mocks.fetch.mockImplementationOnce(async () => responseStream({
      type: 'response.completed',
      response: { status: 'completed', output: [{ type: 'image_generation_call', result: 'image-data' }] }
    }))
    const response = await requestProvider(LLMProviders.OpenAI, '/responses', {
      model: 'gpt-6', input: 'Create an image.', tools: [{ type: 'image_generation' }]
    })
    expect(await response.json()).toMatchObject({
      output: [{ type: 'image_generation_call', result: 'image-data' }]
    })
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })

  it('rejects a broken selected account without using the spare API key', async () => {
    mocks.credentials.mockRejectedValueOnce(new Error('Reconnect bound account'))

    await expect(requestProvider(LLMProviders.OpenAI, '/responses', {
      model: 'gpt-6', input: 'Search.'
    })).rejects.toThrow('Reconnect bound account')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('uses the bound media endpoint before normalizing its provider path', async () => {
    mocks.credentials.mockResolvedValueOnce({
      auth_kind: 'api_key', api_key: 'bound-key',
      base_url: 'https://bound.example.com/anthropic'
    })

    expect(await mediaEndpoint(LLMProviders.MiniMax)).toEqual({
      apiKey: 'bound-key', baseURL: 'https://bound.example.com/v1'
    })
  })

  it('reports terminal built-in failures instead of returning empty success', async () => {
    mocks.fetch.mockResolvedValueOnce(responseStream({
      type: 'response.failed',
      response: { error: { code: 'unsupported_tool', message: 'Tool unavailable' } }
    }))

    await expect(requestProvider(LLMProviders.OpenAI, '/responses', {
      model: 'gpt-6', input: 'Search.', tools: [{ type: 'web_search' }]
    })).rejects.toThrow('unsupported_tool')
    expect(mocks.close).toHaveBeenCalled()
  })
})
