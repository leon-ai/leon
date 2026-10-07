import fs from 'node:fs/promises'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LLMProviders } from '@/core/llm-manager/types'
import { PROVIDER_REQUESTS, requestProvider } from '@/core/llm-manager/provider-requests'
import { mediaEndpoint } from '@/core/llm-manager/media-generation/media-generation-transport'
import HostedTool from '@@/tools/search_web/hosted/src/nodejs/hosted-tool'
import { generateWithProvider } from '@/core/llm-manager/media-generation/media-generation-providers'
import { listMediaCapabilities } from '@/core/llm-manager/media-generation/media-generation-catalog'
import {
  resolveMediaGenerationInput,
  resolveMediaGenerationTarget
} from '@/core/llm-manager/media-generation/media-generation-selection'
import { MediaKind } from '@/core/llm-manager/media-generation/media-generation-types'

const mocks = vi.hoisted(() => ({
  credentials: vi.fn(),
  fetch: vi.fn(),
  create: vi.fn(),
  close: vi.fn(),
  artifact: vi.fn(),
  settings: vi.fn()
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
    getModelState: (): object => ({
      getAgentTarget: (): object => ({ provider: LLMProviders.OpenAI })
    }),
    getModelSettingsState: (): object => ({
      getSettings: (): object => ({ reasoning: 'medium', speed: 'fast' })
    })
  }
}))
vi.mock('@/core/llm-manager/media-generation/media-generation-settings', () => ({
  readGenerationSettings: mocks.settings
}))
vi.mock('@/core/artifacts/artifact-store', () => ({ readArtifact: mocks.artifact }))
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
      auth_kind: 'chatgpt', auth_flow: 'codex', chatgpt_account_id: 'workspace', model: 'gpt-6.1-sol', account_id: 'bound-account', access_token: 'account-token'
    })
    mocks.create.mockImplementation(() => Object.assign(mocks.fetch, { close: mocks.close }))
    mocks.settings.mockResolvedValue({ provider: 'inherit', model: 'auto', options: {} })
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
      if (String(input).startsWith('https://chatgpt.com/')) {
        return mocks.fetch(input, init)
      }
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
    expect(coreFetch).toHaveBeenCalledTimes(3)
    const init = mocks.fetch.mock.calls[0]![1] as RequestInit
    const body = JSON.parse(String(init.body))
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer account-token')
    expect(body).toMatchObject({
      model: 'gpt-6', store: false, stream: true,
      reasoning: { effort: 'medium' }, service_tier: 'priority'
    })
    expect(body.include).toContain('reasoning.encrypted_content')
    expect(body.tools[0].type).toBe('web_search')

    // Built-in media output must survive the same subscription SSE collector.
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
    expect(mocks.create).not.toHaveBeenCalled()
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
    vi.spyOn(globalThis, 'fetch').mockImplementation(mocks.fetch)
    mocks.fetch.mockResolvedValueOnce(responseStream({
      type: 'response.failed',
      response: { error: { code: 'unsupported_tool', message: 'Tool unavailable' } }
    }))

    await expect(requestProvider(LLMProviders.OpenAI, '/responses', {
      model: 'gpt-6', input: 'Search.', tools: [{ type: 'web_search' }]
    })).rejects.toThrow('unsupported_tool')
    expect(mocks.close).not.toHaveBeenCalled()
  })

  it('generates a native Codex image using the selected workspace and refreshes only rejected authorization', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({}, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ data: [{ b64_json: 'aW1hZ2U=' }] }))
    mocks.credentials.mockResolvedValue({
      auth_kind: 'chatgpt', auth_flow: 'codex', chatgpt_account_id: 'workspace',
      account_id: 'bound-account', access_token: 'account-token', model: 'gpt-6.1-sol'
    })
    const result = await generateWithProvider({
      session_id: 'session', provider: LLMProviders.OpenAI, kind: MediaKind.Image,
      model: 'gpt-image-2', prompt: 'A product photograph.'
    })

    expect(result.files?.[0]?.data).toEqual(Buffer.from('image'))
    expect(fetch.mock.calls[0]![0]).toBe('https://chatgpt.com/backend-api/codex/images/generations')
    const headers = new Headers(fetch.mock.calls[0]![1]!.headers)
    expect(headers.get('authorization')).toBe('Bearer account-token')
    expect(headers.get('chatgpt-account-id')).toBe('workspace')
    expect(headers.get('x-codex-image-turn-id')).toBeTruthy()
    expect(new Headers(fetch.mock.calls[1]![1]!.headers).get('x-codex-image-turn-id'))
      .toBe(headers.get('x-codex-image-turn-id'))
    expect(JSON.parse(String(fetch.mock.calls[0]![1]!.body))).toMatchObject({
      model: 'gpt-image-2', n: 1, prompt: 'A product photograph.'
    })
    expect(mocks.credentials).toHaveBeenCalledWith('bound-account', undefined, true)
  })

  it('recommends a subscription image default and rejects API-only routes before submission', async () => {
    const capabilities = (await listMediaCapabilities()).find((entry) => entry['provider'] === 'openai')
    expect(capabilities).toMatchObject({ kinds: ['image'], models: { image: ['gpt-image-2'] } })
    expect(capabilities).not.toHaveProperty('hosted_image')
    expect(await resolveMediaGenerationTarget(MediaKind.Image)).toMatchObject({
      provider: LLMProviders.OpenAI, model: 'gpt-image-2'
    })
    const fetch = vi.spyOn(globalThis, 'fetch')

    await expect(requestProvider(LLMProviders.OpenAI, '/audio/speech', {}))
      .rejects.toThrow('does not support /audio/speech')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['settings', 'override'])('submits an owner-selected image model from %s through the bound subscription', async (source) => {
    const model = 'owner-selected-image-model'

    if (source === 'settings') {
      mocks.settings.mockResolvedValue({ provider: LLMProviders.OpenAI, model, options: {} })
    }

    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({
      data: [{ b64_json: 'aW1hZ2U=' }]
    }))
    const input = await resolveMediaGenerationInput({
      session_id: 'session', kind: MediaKind.Image, prompt: 'A product photograph.',
      ...(source === 'override' ? { provider: LLMProviders.OpenAI, model } : {})
    })
    const result = await generateWithProvider(input)

    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0]![0]).toBe('https://chatgpt.com/backend-api/codex/images/generations')
    expect(JSON.parse(String(fetch.mock.calls[0]![1]!.body))).toMatchObject({ model })
    expect(new Headers(fetch.mock.calls[0]![1]!.headers).get('chatgpt-account-id')).toBe('workspace')
    expect(result.files?.[0]?.data).toEqual(Buffer.from('image'))
  })

  it('returns the provider model rejection without retrying another model or account', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({
      error: { code: 'model_not_found', message: 'The selected image model is unavailable.' }
    }, { status: 400 }))
    const input = await resolveMediaGenerationInput({
      session_id: 'session', kind: MediaKind.Image, prompt: 'A product photograph.',
      provider: LLMProviders.OpenAI, model: 'owner-selected-image-model'
    })

    await expect(generateWithProvider(input)).rejects.toThrow('model_not_found')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('edits subscription images using JSON references and the returned output format', async () => {
    const subscriptionCredentials = {
      auth_kind: 'chatgpt', auth_flow: 'codex', chatgpt_account_id: 'workspace',
      account_id: 'bound-account', access_token: 'account-token'
    }
    mocks.credentials.mockResolvedValue(subscriptionCredentials)
    mocks.artifact.mockResolvedValue({
      path: '/reference.png', artifact: { mime_type: 'image/png', filename: 'reference.png' }
    })
    vi.spyOn(fs, 'readFile').mockResolvedValueOnce(Buffer.from('reference'))
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({
      output_format: 'png', data: [{ b64_json: 'aW1hZ2U=' }]
    }))
    const result = await generateWithProvider({
      session_id: 'session', provider: LLMProviders.OpenAI, kind: MediaKind.Image,
      model: 'gpt-image-2', prompt: 'Improve the product lighting.',
      reference_artifact_ids: ['reference'], options: { output_format: 'webp' }
    })

    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0]![0]).toBe('https://chatgpt.com/backend-api/codex/images/edits')
    const request = fetch.mock.calls[0]![1]!
    const headers = new Headers(request.headers)
    expect(headers.get('authorization')).toBe('Bearer account-token')
    expect(headers.get('chatgpt-account-id')).toBe('workspace')
    expect(JSON.parse(String(request.body))).toMatchObject({
      images: [{ image_url: `data:image/png;base64,${Buffer.from('reference').toString('base64')}` }]
    })
    expect(result.files?.[0]).toMatchObject({ mime_type: 'image/png', filename: 'image-1.png' })
  })

  it('rejects legacy token-sharing accounts before native image submission', async () => {
    mocks.credentials.mockResolvedValueOnce({
      auth_kind: 'chatgpt', access_token: 'legacy-token', account_id: 'bound-account'
    })
    const fetch = vi.spyOn(globalThis, 'fetch')

    await expect(requestProvider(LLMProviders.OpenAI, '/images/generations', {}))
      .rejects.toThrow('/connection ai connect bound-account')
    expect(fetch).not.toHaveBeenCalled()
  })
})
