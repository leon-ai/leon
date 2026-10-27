import fs from 'node:fs/promises'

import Fastify from 'fastify'
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
import { providerRequestsPlugin } from '@/core/http-server/api/inference/provider-requests'

const mocks = vi.hoisted(() => ({
  credentials: vi.fn(),
  fetch: vi.fn(),
  close: vi.fn(),
  artifact: vi.fn(),
  settings: vi.fn(),
  ledger: vi.fn(),
  session: vi.fn(),
  target: vi.fn(),
  socketFetch: vi.fn(),
  socketCreated: vi.fn()
}))

vi.mock('@/core/llm-manager/llm-usage/usage-ledger', () => ({
  appendInferenceUsage: mocks.ledger
}))
vi.mock('@/core/session-manager', () => ({
  CONVERSATION_SESSION_MANAGER: { getSession: mocks.session }
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
      getAgentTarget: mocks.target
    }),
    getModelSettingsState: (): object => ({
      getSettings: (): object => ({ reasoning: 'medium', speed: 'fast' })
    })
  }
}))
vi.mock('@/core/llm-manager/media-generation/media-generation-settings', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/core/llm-manager/media-generation/media-generation-settings')>(),
  readGenerationSettings: mocks.settings
}))
vi.mock('@/core/artifacts/artifact-store', () => ({ readArtifact: mocks.artifact }))
vi.mock('@/core/llm-manager/llm-providers/openai-responses-websocket', () => ({
  OpenAIResponsesWebSocket: class {
    public busy = false
    public constructor() {
      mocks.socketCreated(this)
    }
    public async fetch(body: unknown): Promise<Response> {
      this.busy = true

      try {
        return await mocks.socketFetch(body)
      } catch (error) {
        this.busy = false
        throw error
      }
    }
    public close(): void {
      this.busy = false
      mocks.close(this)
    }
  }
}))
vi.mock('@/core/tool-manager/tool-settings', () => ({
  ToolSettings: {
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
  it.each([
    { provider: LLMProviders.Anthropic, endpoint: '/messages', model: 'claude-opus-5-5',
      event: { type: 'message_start', message: { id: 'provider-response' } } },
    { provider: LLMProviders.OpenAI, endpoint: '/responses', model: 'gpt-6.1-sol',
      event: { type: 'response.in_progress', response: { id: 'provider-response' } } }
  ])('preserves $provider stream activity in auxiliary request failures', async ({ provider, endpoint, model, event }) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(mocks.fetch)
    let upstream!: ReadableStreamDefaultController<Uint8Array>
    mocks.fetch.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(controller): void {
        upstream = controller
      }
    }), { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'provider-request' } }))
    const response = await requestProvider(provider, endpoint, { model, stream: true }, {
      connection: { baseURL: 'https://provider.test/v1', apiKey: 'private-key' }
    })
    const reader = response.body!.getReader()
    upstream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
    await reader.read()
    upstream.error(Object.assign(new Error('Connection reset'), { code: 'ECONNRESET' }))

    await expect(reader.read()).rejects.toMatchObject({
      code: 'ECONNRESET', responseId: 'provider-response',
      providerRequestId: expect.any(String), providerEventCount: 1,
      lastProviderEvent: event.type, requestAcceptedMs: expect.any(Number),
      failureSummary: expect.stringContaining('accepted the request')
    })
  })

  beforeEach(() => {
    mocks.session.mockImplementation((id) => ({ id, modelTarget: null }))
    mocks.target.mockReturnValue({ provider: LLMProviders.OpenAI, model: 'gpt-6.1-sol' })
    mocks.socketFetch.mockRejectedValue(Object.assign(
      new Error('Unsupported handshake'), { statusCode: 426 }
    ))
    mocks.ledger.mockResolvedValue(undefined)
    mocks.credentials.mockResolvedValue({
      auth_kind: 'chatgpt', auth_flow: 'codex', chatgpt_account_id: 'workspace', model: 'gpt-6.1-sol', account_id: 'bound-account', access_token: 'account-token'
    })
    mocks.settings.mockResolvedValue({ provider: 'inherit', model: 'auto', options: {} })
  })

  afterEach(() => {
    PROVIDER_REQUESTS.close()
  })

  it('binds proxy usage to an existing session and rejects unknown sessions before dispatch', async () => {
    mocks.session.mockImplementation((id) =>
      id === 'tool-session' ? { id, modelTarget: null } : null
    )
    mocks.fetch.mockImplementation(async () => responseStream({
      type: 'response.completed', response: {
        usage: { input_tokens: 120, output_tokens: 20, input_tokens_details: { cached_tokens: 80 } }
      }
    }))
    vi.spyOn(globalThis, 'fetch').mockImplementation(mocks.fetch)
    const server = Fastify()
    await server.register(providerRequestsPlugin, { apiVersion: 'v1' })
    const payload = {
      session_id: 'tool-session', provider: 'openai', endpoint: '/responses',
      payload: { model: 'gpt-6', input: 'Search', stream: true }
    }

    try {
      const response = await server.inject({
        method: 'POST', url: '/api/v1/inference/provider-request', payload
      })

      expect(response.statusCode).toBe(200)
      expect(mocks.ledger).toHaveBeenCalledTimes(1)
      expect(mocks.ledger.mock.calls[0]?.[1]).toMatchObject({
        sessionId: 'tool-session', purpose: 'provider-tool', outcome: 'completed',
        usage: { inputTokens: 120, outputTokens: 20, cachedInputTokens: 80 }
      })
      const unknown = await server.inject({
        method: 'POST', url: '/api/v1/inference/provider-request',
        payload: { ...payload, session_id: 'unknown-session' }
      })

      expect(unknown.statusCode).toBeGreaterThanOrEqual(400)
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      expect(mocks.ledger).toHaveBeenCalledTimes(1)
    } finally {
      await server.close()
    }
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
  })

  it('rejects a broken selected account without using the spare API key', async () => {
    mocks.credentials.mockRejectedValueOnce(new Error('Reconnect bound account'))

    await expect(requestProvider(LLMProviders.OpenAI, '/responses', {
      model: 'gpt-6', input: 'Search.'
    })).rejects.toThrow('Reconnect bound account')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it.each([true, false])('forwards provider deltas and reserves a shared socket until consumed (content type: %s)', async (hasContentType) => {
    let upstream!: ReadableStreamDefaultController<Uint8Array>
    const encoder = new TextEncoder()
    const options = { connection: { baseURL: 'https://api.openai.com/v1', apiKey: 'socket-key' } }

    vi.spyOn(globalThis, 'fetch').mockImplementation(mocks.fetch)
    mocks.fetch.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({
      start(controller): void {
        upstream = controller
      }
    }), { headers: hasContentType ? { 'content-type': 'text/event-stream' } : {} }))
    mocks.fetch.mockImplementationOnce(async () => responseStream({
      type: 'response.completed', response: { status: 'completed', output: [] }
    }))

    const response = await requestProvider(LLMProviders.OpenAI, '/responses', {
      model: 'gpt-6', input: 'Stream a response.', stream: true
    }, options)
    const reader = response.body!.getReader()

    expect(response.headers.get('content-type')).toBe('text/event-stream')
    upstream.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":"Available now"}\n\n'))
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('Available now')

    const queued = requestProvider(LLMProviders.OpenAI, '/responses', {
      model: 'gpt-6', input: 'A following request.'
    }, options)

    await Promise.resolve()
    expect(mocks.fetch).toHaveBeenCalledOnce()
    upstream.enqueue(encoder.encode('data: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n'))
    upstream.close()
    await reader.read()
    expect((await reader.read()).done).toBe(true)
    expect(await (await queued).json()).toMatchObject({ status: 'completed' })
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })

  it.each([
    { transport: 'websocket', outcome: 'cancel' },
    { transport: 'websocket', outcome: 'error' },
    { transport: 'http', outcome: 'cancel' },
    { transport: 'http', outcome: 'error' }
  ])('dispatches independent linked-account $transport streams and isolates $outcome', async ({ transport, outcome }) => {
    const upstream: ReadableStreamDefaultController<Uint8Array>[] = []
    const dispatch = transport === 'websocket' ? mocks.socketFetch : mocks.fetch

    vi.spyOn(globalThis, 'fetch').mockImplementation(mocks.fetch)
    dispatch.mockImplementation(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller): void {
        upstream.push(controller)
      }
    }), { headers: { 'content-type': 'text/event-stream' } }))

    const responses: Response[] = []

    for (const input of ['First page', 'Second page']) {
      responses.push(await requestProvider(LLMProviders.OpenAI, '/responses', {
        model: 'gpt-6', input, stream: true
      }))
    }

    expect(dispatch).toHaveBeenCalledTimes(2)
    if (transport === 'websocket') {
      expect(mocks.fetch).not.toHaveBeenCalled()
      expect(mocks.socketCreated).toHaveBeenCalledTimes(2)
    }
    if (outcome === 'cancel') {
      await responses[0]!.body!.cancel()
    } else {
      upstream[0]!.error(new Error('Provider stream interrupted'))
      await expect(responses[0]!.text()).rejects.toThrow('Provider stream interrupted')
    }
    if (transport === 'websocket') {
      expect(mocks.close).not.toHaveBeenCalledWith(mocks.socketCreated.mock.calls[1]![0])
    }
    upstream[1]!.enqueue(new TextEncoder().encode(
      'data: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n'
    ))
    upstream[1]!.close()
    expect(await responses[1]!.text()).toContain('response.completed')
    expect(mocks.ledger.mock.calls.at(-1)?.[1].outcome).toBe('completed')
  })

  it.each(['cancel', 'error'])('releases streamed provider requests after %s', async (outcome) => {
    let upstream!: ReadableStreamDefaultController<Uint8Array>

    vi.spyOn(globalThis, 'fetch').mockImplementation(mocks.fetch)
    mocks.fetch.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({
      start(controller): void {
        upstream = controller
      }
    }), { headers: { 'content-type': 'text/event-stream' } }))

    const response = await requestProvider(LLMProviders.OpenAI, '/responses', {
      model: 'gpt-6', input: 'Stream a response.', stream: true
    })
    const reader = response.body!.getReader()

    if (outcome === 'cancel') {
      await reader.cancel()
    } else {
      upstream.error(new Error('Provider stream interrupted'))
      await expect(reader.read()).rejects.toThrow('Provider stream interrupted')
    }

    mocks.fetch.mockResolvedValueOnce(responseStream({
      type: 'response.completed', response: { status: 'completed', output: [] }
    }))
    const following = await requestProvider(LLMProviders.OpenAI, '/responses', {
      model: 'gpt-6', input: 'A following request.'
    })

    expect(await following.json()).toMatchObject({ status: 'completed' })
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
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
  })

  

  it('recommends a subscription image default and rejects API-only routes before submission', async () => {
    const capabilities = (await listMediaCapabilities()).find((entry) => entry['provider'] === 'openai')
    expect(capabilities).toMatchObject({ kinds: ['image'], models: { image: ['gpt-image-2'] } })
    expect(capabilities).not.toHaveProperty('hosted_image')
    mocks.credentials.mockClear()
    expect(await resolveMediaGenerationTarget(MediaKind.Image)).toMatchObject({
      provider: LLMProviders.OpenAI, model: 'gpt-image-2'
    })
    expect(mocks.credentials).toHaveBeenCalledOnce()
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

  

  

  

  

  

  it.each([true, false])('keeps image edit formatting and dispatch bound when account selection changes (subscription: %s)', async (subscription) => {
    const subscriptionCredentials = {
      auth_kind: 'chatgpt', auth_flow: 'codex', chatgpt_account_id: 'workspace',
      account_id: 'bound-account', access_token: 'account-token'
    }
    const apiCredentials = { auth_kind: 'api_key', api_key: 'bound-key' }
    const boundCredentials = subscription ? subscriptionCredentials : apiCredentials
    let selectedCredentials = boundCredentials
    mocks.credentials.mockImplementation(async (id: string) => {
      if (id === LLMProviders.OpenAI) {
        const credentials = selectedCredentials
        selectedCredentials = subscription ? apiCredentials : subscriptionCredentials

        return credentials
      }

      return boundCredentials
    })
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
    expect(fetch.mock.calls[0]![0]).toBe(subscription
      ? 'https://chatgpt.com/backend-api/codex/images/edits'
      : 'https://api.openai.com/v1/images/edits')
    const request = fetch.mock.calls[0]![1]!
    const headers = new Headers(request.headers)
    expect(headers.get('authorization')).toBe(subscription ? 'Bearer account-token' : 'Bearer bound-key')
    if (subscription) {
      expect(headers.get('chatgpt-account-id')).toBe('workspace')
      expect(JSON.parse(String(request.body))).toMatchObject({
        images: [{ image_url: `data:image/png;base64,${Buffer.from('reference').toString('base64')}` }]
      })
    } else {
      expect(request.body).toBeInstanceOf(FormData)
      const form = request.body as FormData
      expect(form.get('model')).toBe('gpt-image-2')
      const reference = form.get('image[]') as Blob
      expect(reference.type).toBe('image/png')
      expect(await reference.text()).toBe('reference')
    }
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
