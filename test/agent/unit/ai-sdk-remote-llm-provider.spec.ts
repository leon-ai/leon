import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResolvedLLMTarget } from '@/core/llm-manager/llm-routing'
import type {
  CompletionParams,
  PromptOrChatHistory
} from '@/core/llm-manager/types'
import { LLMDuties, LLMProviders } from '@/core/llm-manager/types'
import OpenRouterLLMProvider from '@/core/llm-manager/llm-providers/openrouter-llm-provider'
import OpenAILLMProvider from '@/core/llm-manager/llm-providers/openai-llm-provider'
import CelerisLLMProvider from '@/core/llm-manager/llm-providers/celeris-llm-provider'
import MiniMaxLLMProvider from '@/core/llm-manager/llm-providers/minimax-llm-provider'
import AnthropicLLMProvider from '@/core/llm-manager/llm-providers/anthropic-llm-provider'
import AISDKRemoteLLMProvider from '@/core/llm-manager/llm-providers/ai-sdk-remote-llm-provider'
import { readCompletionAccounting } from '@/core/llm-manager/usage-accounting'
import { CONFIG_MANAGER } from '@/config'
import {
  getActiveTurnInference,
  runWithConversationSession
} from '@/core/session-manager/session-context'
import {
  InferenceAuthMode,
  InferenceCredentialSource,
  type TurnInference
} from '@/core/llm-manager/inference-metadata'
import { AgentAnswerStream } from '@/core/llm-manager/llm-duties/react-llm-duty/agent-answer-stream'
import { normalizeCompletionResultForOpenAICompatibleProvider } from '@/core/llm-manager/llm-provider/llm-provider-response'

const mediaMocks = vi.hoisted(() => ({
  persist: vi
    .fn()
    .mockResolvedValue({ artifacts: [{ id: 'image', filename: 'image.png' }] })
}))
const accountMocks = vi.hoisted(() => ({
  getCredentials: vi.fn(),
  markNeedsAttention: vi.fn()
}))
vi.mock('@/core/llm-manager/llm-accounts', () => ({
  MODEL_ACCOUNT_STORE: accountMocks
}))

const websocketMocks = vi.hoisted(() => ({
  create: vi.fn(),
  fetch: vi.fn(),
  close: vi.fn()
}))

vi.mock('@vercel/ai-sdk-openai-websocket-fetch', () => ({
  createWebSocketFetch: websocketMocks.create
}))

vi.mock('@/core/llm-manager/media-generation/media-generation-service', () => ({
  persistGeneratedFiles: mediaMocks.persist
}))
vi.mock('@/core/session-manager/session-context', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/core/session-manager/session-context')>(),
  getActiveConversationSessionId: (): string => 'media-session'
}))

const openRouterMocks = vi.hoisted(() => {
  const languageModel = {
    doGenerate: vi.fn(),
    doStream: vi.fn()
  }
  const chat = vi.fn(() => languageModel)
  const createOpenRouter = vi.fn(() => ({
    chat
  }))

  return {
    chat,
    createOpenRouter,
    languageModel
  }
})

vi.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: openRouterMocks.createOpenRouter
}))

vi.mock('@/config', () => ({
  CONFIG_MANAGER: {
    getProviderAPIKeyEnv: vi.fn(() => null),
    getProviderAPIKey: vi.fn(() => 'test-openrouter-key'),
    getProviderBaseURL: vi.fn(() => null)
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
  config: { flavor: string }
  buildCallOptions(
    prompt: PromptOrChatHistory,
    completionParams: CompletionParams
  ): Record<string, unknown>
  runChatCompletion(
    prompt: PromptOrChatHistory,
    completionParams: CompletionParams
  ): Promise<{ data: Record<string, unknown> }>
}

function createOpenRouterProvider(model = 'qwen/qwen3.8-flash'): ProviderWithPrivateCallOptions {
  const target: ResolvedLLMTarget = {
    provider: LLMProviders.OpenRouter,
    model,
    label: `openrouter/${model}`,
    isLocal: false,
    isEnabled: true,
    isResolved: true
  }

  return new OpenRouterLLMProvider(target) as unknown as ProviderWithPrivateCallOptions
}

function createCompletionParams(
  data: CompletionParams['data']
): CompletionParams {
  return {
    dutyType: LLMDuties.ReAct,
    systemPrompt: 'Plan the next step.',
    data
  }
}

const TOOL = {
  type: 'function' as const,
  function: {
    name: 'read_file',
    parameters: { type: 'object', properties: { path: { type: 'string' } } }
  }
}
const PARAMS = {
  dutyType: LLMDuties.ReAct,
  systemPrompt: 'Read the requested file.',
  tools: [TOOL],
  toolChoice: 'auto' as const,
  reasoningMode: 'on' as const
}
const TARGET = {
  label: 'Test provider',
  isEnabled: true,
  isLocal: false,
  isResolved: true,
  accountCredentials: { api_key: 'fixture-key' }
}
const CHAT_RESPONSE = {
  id: 'response-1',
  created: 1,
  model: 'fixture-model',
  choices: [{
    index: 0,
    finish_reason: 'tool_calls',
    message: {
      role: 'assistant',
      content: '',
      reasoning_content: 'Inspect the file.',
      tool_calls: [{
        id: 'call-1',
        type: 'function',
        function: { name: 'read_file', arguments: '{"path":"README.md"}' }
      }]
    }
  }],
  usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_cache_hit_tokens: 80 }
}

describe('AISDKRemoteLLMProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    [LLMProviders.MiniMax, 'openai-compatible', 'MiniMax-M3'],
    [LLMProviders.Celeris, 'openai-compatible', 'celeris-1-magnus'],
    [LLMProviders.SGLang, 'openai-compatible', 'local-model'],
    [LLMProviders.LlamaCPP, 'openai-compatible', 'local-model'],
    [LLMProviders.Cerebras, 'cerebras', 'gpt-oss-120b'],
    [LLMProviders.MoonshotAI, 'moonshotai', 'kimi-k3'],
    [LLMProviders.Groq, 'groq', 'openai/gpt-oss-120b']
  ] as const)('retains incremental text and cache usage through the %s SDK adapter', async (name, flavor, model) => {
    const usage = {
      prompt_tokens: 100, completion_tokens: 20,
      ...(name === LLMProviders.MoonshotAI
        ? { cached_tokens: 80 }
        : { prompt_tokens_details: { cached_tokens: 80 } })
    }
    const events = [
      { id: 'test', choices: [{ index: 0, delta: { content: 'Yes ' } }] },
      { id: 'test', choices: [{ index: 0, delta: { content: 'Yes ' } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage, x_groq: { usage } }
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } }
    )))
    const provider = new AISDKRemoteLLMProvider({
      name, providerName: name, model, flavor, apiKeyEnv: 'TEST_KEY', baseURL: 'https://example.invalid/v1'
    })
    const onToken = vi.fn()
    const response = await provider.runChatCompletion('Answer.', {
      ...createCompletionParams(null),
      shouldStream: true,
      onToken
    })
    const normalized = normalizeCompletionResultForOpenAICompatibleProvider(response)
    expect(onToken.mock.calls.map(([chunk]) => chunk).join('')).toBe('Yes Yes ')
    expect(normalized).toMatchObject({
      usedInputTokens: 100, usedOutputTokens: 20, accounting: { cachedInputTokens: 80 }
    })
  })

  it('distinguishes unavailable cache accounting from a reported zero', () => {
    const inputTokens = { total: 100, cacheRead: 0, cacheWrite: 0 }
    expect(readCompletionAccounting({ inputTokens, raw: { prompt_tokens: 100 } })).toEqual({})
    expect(readCompletionAccounting({ inputTokens, raw: {
      prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 0 }
    } })).toEqual({ cachedInputTokens: 0 })
  })

  it.each([LLMProviders.Anthropic])('preserves %s cache accounting and signed thinking through streamed tool turns', async (providerName) => {
    const model = providerName === LLMProviders.Anthropic ? 'claude-opus-5-5' : 'MiniMax-M3'
    const message = { id: 'msg_claude', type: 'message', role: 'assistant', model,
      content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 80, cache_creation_input_tokens: 10 } }
    const events = [
      { type: 'message_start', message },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '  check ' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'check \n' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'complete' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } },
      { type: 'message_stop' }
    ]
    const fetch = vi.fn().mockImplementation(async () => new Response(
      events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
      { headers: { 'content-type': 'text/event-stream' } }
    ))
    vi.stubGlobal('fetch', fetch)
    const target = {
      provider: providerName, model, label: providerName,
      isEnabled: true, isLocal: false, isResolved: true
    }
    const provider = providerName === LLMProviders.Anthropic
      ? new AnthropicLLMProvider(target)
      : new MiniMaxLLMProvider({
          ...target,
          accountCredentials: {
            api_key: 'minimax-account-key', base_url: 'https://api.minimax.io/anthropic/v1'
          }
        })
    const params = { ...createCompletionParams(null), shouldStream: true, promptCacheKey: 'agent' }
    const normalized = normalizeCompletionResultForOpenAICompatibleProvider(
      await provider.runChatCompletion('Check.', params)
    )
    expect(normalized).toMatchObject({
      usedInputTokens: 190, usedOutputTokens: 20,
      accounting: { cachedInputTokens: 80, cacheWriteInputTokens: 10 },
      reasoningItems: [{ provider: providerName, text: '  check check \n', providerOptions: { anthropic: { signature: 'sig-complete' } } }]
    })
    await provider.runChatCompletion([
      { role: 'user', content: 'Check.' },
      { role: 'assistant', content: '', reasoningItems: normalized.reasoningItems,
        toolCalls: [{ id: 'tool_claude', type: 'function', function: { name: 'check', arguments: '{}' } }] },
      { role: 'tool', toolCallId: 'tool_claude', toolName: 'check', content: 'Checked.' }
    ], params)
    const body = JSON.parse(fetch.mock.calls[1]![1].body)
    if (providerName === LLMProviders.Anthropic) {
      expect(body.cache_control).toEqual({ type: 'ephemeral' })
    } else {
      expect(String(fetch.mock.calls[1]![0])).toBe('https://api.minimax.io/anthropic/v1/messages')
      expect(new Headers(fetch.mock.calls[1]![1].headers).get('x-api-key')).toBe('minimax-account-key')
      expect(body.thinking).toEqual({ type: 'adaptive' })
      expect(body.cache_control).toBeUndefined()
    }
    expect(body.messages[1].content).toContainEqual({
      type: 'thinking', thinking: '  check check \n', signature: 'sig-complete'
    })
  })

  it('replays OpenRouter reasoning details and retains cache usage with stable session routing', async () => {
    const actual = await vi.importActual<typeof import('@openrouter/ai-sdk-provider')>('@openrouter/ai-sdk-provider')
    openRouterMocks.createOpenRouter.mockImplementationOnce((...args: unknown[]) =>
      actual.createOpenRouter(args[0] as Parameters<typeof actual.createOpenRouter>[0]) as unknown as
        ReturnType<typeof openRouterMocks.createOpenRouter>
    )
    const reasoningDetails = [
      { type: 'reasoning.text', text: '  check \n', signature: 'signature', format: 'anthropic-claude-v1', index: 0 },
      { type: 'reasoning.encrypted', data: 'encrypted', id: 'rs_or', format: 'openai-responses-v1', index: 1 }
    ]
    const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120,
      prompt_tokens_details: { cached_tokens: 80, cache_write_tokens: 10 }, cost: 0.001 }
    const events = [
      { id: 'or_test', choices: [{ index: 0, delta: { reasoning_details: reasoningDetails } }] },
      { choices: [{ index: 0, delta: { content: 'Done.' }, finish_reason: 'stop' }], usage }
    ]
    const fetch = vi.fn().mockImplementation(async () => new Response(
      events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } }
    ))
    vi.stubGlobal('fetch', fetch)
    const provider = createOpenRouterProvider('anthropic/claude-opus-5.5')
    const params = { ...createCompletionParams(null), shouldStream: true, promptCacheKey: 'agent',
      serviceTier: 'priority' as const }
    const normalized = normalizeCompletionResultForOpenAICompatibleProvider(
      await provider.runChatCompletion('Check.', params)
    )
    expect(normalized.accounting).toMatchObject({ cachedInputTokens: 80, cacheWriteInputTokens: 10, costUSD: 0.001 })
    await provider.runChatCompletion([
      { role: 'user', content: 'Check.' },
      { role: 'assistant', content: '', reasoningItems: normalized.reasoningItems,
        toolCalls: [{ id: 'tool_or', type: 'function', function: { name: 'check', arguments: '{}' } }] },
      { role: 'tool', toolCallId: 'tool_or', toolName: 'check', content: 'Checked.' }
    ], params)
    const body = JSON.parse(fetch.mock.calls[1]![1].body)
    expect(body).toMatchObject({ provider: { sort: 'throughput' }, session_id: 'media-session' })
    expect(body.messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(body.messages[2].reasoning_details).toEqual(reasoningDetails)
  })
  it.each([
    { auth_kind: 'api_key', expected: 'https://openrouter.ai/api/v1' },
    { auth_kind: 'api_key', base_url: 'https://fellow.example.invalid/v1', expected: 'https://fellow.example.invalid/v1' },
    { auth_kind: 'openrouter', expected: 'https://openrouter.ai/api/v1' }
  ])('keeps a linked $auth_kind key off an older profile endpoint ($expected)', ({ expected, ...credentials }) => {
    vi.mocked(CONFIG_MANAGER.getProviderBaseURL).mockReturnValueOnce('https://old-proxy.example.invalid/v1')
    new OpenRouterLLMProvider({
      provider: LLMProviders.OpenRouter, model: 'anthropic/test-model', label: 'openrouter/anthropic/test-model',
      isEnabled: true, isLocal: false, isResolved: true,
      accountCredentials: { ...credentials, api_key: 'test-key' }
    })
    expect(openRouterMocks.createOpenRouter).toHaveBeenLastCalledWith(expect.objectContaining({ baseURL: expected }))
    vi.mocked(CONFIG_MANAGER.getProviderBaseURL).mockReset().mockReturnValue(null)
  })

  it('preserves provider endpoint formatting after resolving the configured URL', () => {
    const target: ResolvedLLMTarget = {
      provider: LLMProviders.Celeris, model: 'celeris-1-magnus', label: 'celeris/celeris-1-magnus',
      isEnabled: true, isLocal: false, isResolved: true
    }
    vi.mocked(CONFIG_MANAGER.getProviderBaseURL).mockReturnValueOnce('https://inference.celeris.ai/celeris-1/v1')
    const celeris = new CelerisLLMProvider(target) as unknown as { config: { baseURL: string } }
    expect(celeris.config.baseURL).toBe('https://inference.celeris.ai/celeris-1-magnus/v1')
    vi.mocked(CONFIG_MANAGER.getProviderBaseURL).mockReturnValueOnce('https://api.minimax.io/anthropic')
    const minimax = new MiniMaxLLMProvider({ ...target, provider: LLMProviders.MiniMax, model: 'MiniMax-M3' }) as unknown as {
      config: { baseURL: string, flavor: string }
    }
    expect(minimax.config).toMatchObject({ baseURL: 'https://api.minimax.io/anthropic/v1', flavor: 'anthropic' })
  })

  it('reuses account websockets and preserves cache usage, summaries and encrypted reasoning for replay', async () => {
    accountMocks.getCredentials.mockResolvedValue({ access_token: 'fresh-chatgpt-token' })
    const call = { type: 'function_call', id: 'fc_test', call_id: 'call_test',
      name: 'read_note', namespace: 'leon', arguments: '{"name":"todo"}', status: 'completed' }
    const reasoning = {
      type: 'reasoning',
      id: 'rs_test',
      encrypted_content: 'encrypted-test',
      summary: [{ type: 'summary_text', text: 'Checking the note.' }]
    }
    const response = { id: 'resp_test', created_at: 1, model: 'gpt-6.1-sol',
      status: 'completed', output: [reasoning, call], usage: {
        input_tokens: 1_536, output_tokens: 24, total_tokens: 1_560,
        input_tokens_details: { cached_tokens: 1_024 }, output_tokens_details: { reasoning_tokens: 10 }
      } }
    const events = [
      { type: 'response.created', response: { ...response, output: [], status: 'in_progress' } },
      { type: 'response.output_item.added', output_index: 0, item: { ...reasoning, summary: [] } },
      { type: 'response.reasoning_summary_text.delta', item_id: reasoning.id, output_index: 0,
        summary_index: 0, delta: 'Checking the note.' },
      { type: 'response.output_item.done', output_index: 0, item: reasoning },
      { type: 'response.output_item.added', output_index: 1, item: { ...call, arguments: '', status: 'in_progress' } },
      { type: 'response.function_call_arguments.delta', item_id: call.id, output_index: 1, delta: call.arguments },
      { type: 'response.output_item.done', output_index: 1, item: call },
      { type: 'response.completed', response }
    ]
    websocketMocks.fetch.mockImplementation(async () => new Response(
      events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
      { headers: { 'content-type': 'text/event-stream' } }
    ))
    const provider = new OpenAILLMProvider({
      provider: LLMProviders.OpenAI, model: response.model, label: `openai/${response.model}`,
      isEnabled: true, isLocal: false, isResolved: true,
      accountCredentials: { auth_kind: 'chatgpt', access_token: 'old-chatgpt-token', account_id: 'openai.test' }
    })
    const onReasoningToken = vi.fn()
    const onStreamEvent = vi.fn()
    const params = {
      ...createCompletionParams(null), shouldStream: false, temperature: 0.5,
      reasoningMode: 'on' as const, reasoningEffort: 'medium' as const,
      reasoningSummary: 'auto' as const, promptCacheKey: 'leon-test',
      onReasoningToken, onStreamEvent,
      tools: [{ type: 'function', function: { name: 'read_note', description: 'Read a note',
        parameters: { type: 'object', properties: { name: { type: 'string' } } }
      } }]
    } satisfies CompletionParams
    let inference: TurnInference | undefined
    const result = await runWithConversationSession(
      { sessionId: 'media-session' },
      async () => {
        expect(getActiveTurnInference()).toBeNull()
        const completion = await provider.runChatCompletion('Read my note.', params)
        inference = getActiveTurnInference()

        return completion
      }
    )

    expect(inference).toMatchObject({
      provider: LLMProviders.OpenAI,
      model: response.model,
      authMode: InferenceAuthMode.ChatGPTOAuth,
      credentialSource: InferenceCredentialSource.AccountBinding,
      connectionRef: expect.any(String),
      endpoint: 'wss://api.openai.com/v1/responses'
    })
    expect(JSON.stringify(inference)).not.toContain('openai.test')
    expect(JSON.stringify(inference)).not.toContain('chatgpt-token')
    expect(getActiveTurnInference()).toBeUndefined()

    const [url, request] = websocketMocks.fetch.mock.calls[0]!
    expect(String(url)).toBe('https://api.openai.com/v1/responses')
    expect(new Headers(request?.headers).get('authorization')).toBe('Bearer fresh-chatgpt-token')
    const body = JSON.parse(request?.body as string)
    expect(body).toMatchObject({ stream: true, store: false, tools: [{ type: 'namespace', name: 'leon' }] })
    expect(body.temperature).toBeUndefined()
    expect(body.input[0].role).toBe('developer')
    expect(body).toMatchObject({
      reasoning: { effort: 'medium', summary: 'auto' },
      include: ['reasoning.encrypted_content'], prompt_cache_key: 'leon-test'
    })
    expect(result.data.choices[0].message.tool_calls[0].function.name).toBe('read_note')
    expect(onReasoningToken).toHaveBeenCalledWith('Checking the note.')
    expect(onStreamEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'stream-open', transport: 'websocket'
    }))
    const normalized = normalizeCompletionResultForOpenAICompatibleProvider(result)
    expect(normalized.accounting?.cachedInputTokens).toBe(1_024)
    expect(normalized.accounting?.reasoningOutputTokens).toBe(10)
    expect(normalized.reasoningItems).toEqual([{
      provider: LLMProviders.OpenAI, id: 'rs_test', text: 'Checking the note.',
      encryptedContent: 'encrypted-test'
    }])

    await provider.runChatCompletion([
      { role: 'user', content: 'Read my note.' },
      { role: 'assistant', content: '', toolCalls: normalized.toolCalls,
        reasoningItems: normalized.reasoningItems },
      { role: 'tool', toolName: 'read_note', toolCallId: 'call_test', content: 'Note contents.' }
    ], params)
    const replay = JSON.parse(websocketMocks.fetch.mock.calls[1]![1].body)
    expect(replay.input).toContainEqual(reasoning)
    expect(websocketMocks.create).toHaveBeenCalledTimes(1)
    expect(accountMocks.getCredentials).toHaveBeenCalledWith('openai.test')
    provider.dispose()
  })

  it('finishes an incomplete websocket response even when the adapter leaves it open', async () => {
    const response = {
      id: 'resp_limited', created_at: 1, model: 'gpt-6.1-sol', status: 'incomplete',
      output: [], incomplete_details: { reason: 'max_output_tokens' },
      usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 }
    }
    websocketMocks.fetch.mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller): void {
        controller.enqueue(new TextEncoder().encode(
          `data: ${JSON.stringify({ type: 'response.incomplete', response })}\n\n`
        ))
      }
    }), { headers: { 'content-type': 'text/event-stream' } }))
    const provider = new OpenAILLMProvider({
      provider: LLMProviders.OpenAI, model: response.model, label: 'OpenAI',
      isEnabled: true, isLocal: false, isResolved: true
    })

    try {
      const result = await runWithConversationSession(
        { sessionId: 'api-session' },
        async () => {
          const completion = await provider.runChatCompletion('Continue.', {
            ...createCompletionParams(null), shouldStream: true
          })
          expect(getActiveTurnInference()).toEqual({
            provider: LLMProviders.OpenAI,
            model: response.model,
            authMode: InferenceAuthMode.APIKey,
            credentialSource: InferenceCredentialSource.ProfileAPIKey,
            endpoint: 'wss://api.openai.com/v1/responses'
          })

          return completion
        }
      )
      expect(result.data.choices[0].finish_reason).toBe('length')
      expect(result.data.usage).toMatchObject({ prompt_tokens: 100, completion_tokens: 10 })
      expect(websocketMocks.close).toHaveBeenCalled()
    } finally {
      provider.dispose()
    }
  }, 2_000)

  it('refreshes a rejected websocket token once and retires sockets when credentials change', async () => {
    accountMocks.getCredentials
      .mockResolvedValueOnce({ access_token: 'expired-token' })
      .mockResolvedValueOnce({ access_token: 'fresh-token' })
      .mockResolvedValueOnce({ access_token: 'rotated-token' })
    websocketMocks.fetch
      .mockRejectedValueOnce(new Error('Unexpected server response: 401'))
      .mockResolvedValueOnce(new Response('data: [DONE]\n\n'))
      .mockResolvedValueOnce(new Response('data: [DONE]\n\n'))
    const provider = new OpenAILLMProvider({
      provider: LLMProviders.OpenAI,
      model: 'gpt-6.1-sol',
      label: 'OpenAI',
      isEnabled: true,
      isLocal: false,
      isResolved: true,
      accountCredentials: {
        auth_kind: 'chatgpt',
        access_token: 'expired-token',
        account_id: 'openai.test'
      }
    })

    await provider.runChatCompletion('Hello.', createCompletionParams(null))
    await provider.runChatCompletion('Hello again.', createCompletionParams(null))

    expect(accountMocks.getCredentials).toHaveBeenCalledWith('openai.test', undefined, true)
    expect(websocketMocks.create).toHaveBeenCalledTimes(3)
    expect(websocketMocks.fetch.mock.calls.map(([, request]) =>
      new Headers(request.headers).get('authorization')
    )).toEqual(['Bearer expired-token', 'Bearer fresh-token', 'Bearer rotated-token'])
    expect(websocketMocks.close).toHaveBeenCalledTimes(2)
    expect(accountMocks.markNeedsAttention).not.toHaveBeenCalled()
    provider.dispose()
  })

  it('reports reconnect after a forbidden websocket without switching accounts', async () => {
    accountMocks.getCredentials.mockResolvedValue({ access_token: 'revoked-token' })
    websocketMocks.fetch.mockRejectedValueOnce(new Error('Unexpected server response: 403'))
    const provider = new OpenAILLMProvider({
      provider: LLMProviders.OpenAI,
      model: 'gpt-6.1-sol',
      label: 'OpenAI',
      isEnabled: true,
      isLocal: false,
      isResolved: true,
      accountCredentials: {
        auth_kind: 'chatgpt',
        access_token: 'revoked-token',
        account_id: 'openai.test'
      }
    })

    await expect(provider.runChatCompletion('Hello.', createCompletionParams(null)))
      .rejects.toThrow('/connection ai connect openai.test')
    expect(accountMocks.getCredentials).toHaveBeenCalledTimes(1)
    expect(accountMocks.markNeedsAttention).toHaveBeenCalledWith('openai.test')
    provider.dispose()
  })

  it.each(['audio/wav', 'video/mp4'])('preserves %s only for a cataloged native-media endpoint', (mediaType) => {
    const options = createOpenRouterProvider('meta/muse-spark-1.3').buildCallOptions([
      { role: 'user', content: 'Describe the attachment.', files: [{ dataBase64: 'bWVkaWE=', mediaType }] }
    ], createCompletionParams(null))
    expect(options['prompt']).toContainEqual({ role: 'user', content: [
      { type: 'text', text: 'Describe the attachment.' },
      { type: 'file', data: { type: 'data', data: 'bWVkaWE=' }, mediaType }
    ] })
  })
  it.each(['z-ai/glm-5.3', 'unknown-model'])('keeps local fallback references without sending unsupported media to %s', (model) => {
    const options = createOpenRouterProvider(model).buildCallOptions([{ role: 'user', content: 'Source: /local/image.png',
      files: [{ dataBase64: 'aW1hZ2U=', mediaType: 'image/png' }] }], createCompletionParams(null))
    expect(JSON.stringify(options['prompt'])).toContain('/local/image.png')
    expect(JSON.stringify(options['prompt'])).toContain('local document extraction/OCR')
    expect(JSON.stringify(options['prompt'])).not.toContain('aW1hZ2U=')
  })
  it('preserves owner image parts alongside the request without an auxiliary call', () => {
    const provider = createOpenRouterProvider()
    const options = provider.buildCallOptions([{ role: 'user', content: 'Read this page.',
      files: [{ dataBase64: 'aW1hZ2U=', mediaType: 'image/png', filename: 'page.png' }] }], createCompletionParams(null))
    expect(options['prompt']).toContainEqual({ role: 'user', content: [
      { type: 'text', text: 'Read this page.' },
      { type: 'file', data: { type: 'data', data: 'aW1hZ2U=' }, mediaType: 'image/png', filename: 'page.png' }
    ] })
    expect(openRouterMocks.languageModel.doGenerate).not.toHaveBeenCalled()
  })
  it('retires an aborted websocket before another completion can reuse it', async () => {
    const controller = new AbortController()
    const provider = new OpenAILLMProvider({
      provider: LLMProviders.OpenAI,
      model: 'gpt-6.1-sol',
      label: 'OpenAI',
      isEnabled: true,
      isLocal: false,
      isResolved: true,
      accountCredentials: { auth_kind: 'api_key', api_key: 'selected-key' }
    })
    websocketMocks.fetch
      .mockImplementationOnce(async () => {
        controller.abort(new Error('Canceled'))
        return new Response('data: [DONE]\n\n')
      })
      .mockResolvedValueOnce(new Response('data: [DONE]\n\n'))

    await expect(provider.runChatCompletion('Old turn', {
      ...createCompletionParams(null),
      shouldStream: true,
      signal: controller.signal
    })).rejects.toThrow('Canceled')
    expect(websocketMocks.close).toHaveBeenCalled()

    await provider.runChatCompletion('New turn', {
      ...createCompletionParams(null),
      shouldStream: true
    })
    expect(websocketMocks.create).toHaveBeenCalledTimes(2)
    provider.dispose()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    websocketMocks.fetch.mockReset()
    websocketMocks.create.mockImplementation(() => {
      return Object.assign(
        (...args: unknown[]) => {
          return websocketMocks.fetch(...args)
        },
        { close: websocketMocks.close }
      )
    })
    vi.stubEnv('LEON_OPENROUTER_API_KEY', 'test-openrouter-key')
  })

  it('adds a JSON instruction when structured response format is enabled', () => {
    const provider = createOpenRouterProvider()
    const options = provider.buildCallOptions('Choose a tool.', createCompletionParams({
      type: 'object',
      properties: {
        type: { type: 'string' }
      },
      required: ['type'],
      additionalProperties: false
    }))

    const messages = options['prompt'] as Array<Record<string, unknown>>
    const systemMessage = messages[0] as Record<string, unknown>

    expect(systemMessage['role']).toBe('system')
    expect(systemMessage['content']).toContain('JSON')
    expect(options['responseFormat']).toEqual({
      type: 'json',
      schema: {
        type: 'object',
        properties: {
          type: { type: 'string' }
        },
        required: ['type'],
        additionalProperties: false
      },
      name: 'structured_output'
    })
  })

  it('does not add the JSON instruction for plain text calls', () => {
    const provider = createOpenRouterProvider()
    const options = provider.buildCallOptions(
      'Answer normally.',
      createCompletionParams(null)
    )

    const messages = options['prompt'] as Array<Record<string, unknown>>
    const systemMessage = messages[0] as Record<string, unknown>

    expect(systemMessage['content']).toBe('Plan the next step.')
    expect(options['responseFormat']).toBeUndefined()
  })

  it('forwards deterministic generation options to the provider', () => {
    const provider = createOpenRouterProvider()
    const options = provider.buildCallOptions('Choose a tool.', {
      ...createCompletionParams(null),
      seed: 7,
      temperature: 0
    })

    expect(options['seed']).toBe(7)
    expect(options['temperature']).toBe(0)
  })

  it('preserves assistant tool calls and matching tool results', () => {
    const provider = createOpenRouterProvider()
    const options = provider.buildCallOptions(
      [
        { role: 'user', content: 'Look up the current value.' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'test__lookup__run',
                arguments: JSON.stringify({ query: 'current value' })
              }
            }
          ]
        },
        {
          role: 'tool',
          toolCallId: 'call_1',
          toolName: 'test__lookup__run',
          content: 'The value is 42.'
        }
      ],
      createCompletionParams(null)
    )

    expect(options['prompt']).toEqual([
      { role: 'system', content: 'Plan the next step.' },
      {
        role: 'user',
        content: [{ type: 'text', text: 'Look up the current value.' }]
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_1',
            toolName: 'test__lookup__run',
            input: { query: 'current value' }
          }
        ]
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_1',
            toolName: 'test__lookup__run',
            output: {
              type: 'text',
              value: 'The value is 42.'
            }
          }
        ]
      }
    ])
  })

  it.each([
    'openai-responses',
    'openrouter',
    'openai-compatible',
    'anthropic',
    'moonshotai',
    'huggingface',
    'cerebras',
    'groq'
  ])('delivers tool images through the portable %s schema', (flavor) => {
    const provider = createOpenRouterProvider()
    provider.config.flavor = flavor
    const options = provider.buildCallOptions(
      [
        { role: 'user', content: 'Inspect the window.' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call_vision',
              type: 'function',
              function: {
                name: 'computer_use__cua__get_window_state',
                arguments: '{}'
              }
            }
          ]
        },
        {
          role: 'tool',
          toolCallId: 'call_vision',
          toolName: 'computer_use__cua__get_window_state',
          content: 'Window captured.',
          files: [
            {
              dataBase64: 'aW1hZ2U=',
              mediaType: 'image/png',
              filename: 'window.png',
              visualDetail: 'high'
            }
          ]
        }
      ],
      createCompletionParams(null)
    )
    const messages = options['prompt'] as Array<Record<string, unknown>>

    expect(messages[3]).toMatchObject({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          output: {
            type: 'text',
            value: 'Window captured.'
          }
        }
      ]
    })
    const imagePart = {
      type: 'file',
      mediaType: 'image/png',
      filename: 'window.png',
      ...(flavor === 'openai-responses'
        ? {
            providerOptions: {
              openai: { imageDetail: 'high' }
            }
          }
        : {})
    }
    expect(messages[4]).toMatchObject({
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Visual evidence returned by computer_use__cua__get_window_state.'
        },
        imagePart
      ]
    })
  })

  it('keeps parallel tool results ahead of their visual evidence', () => {
    const provider = createOpenRouterProvider()
    const options = provider.buildCallOptions(
      [
        { role: 'user', content: 'Inspect both windows.' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'inspect_first', arguments: '{}' }
            },
            {
              id: 'call_2',
              type: 'function',
              function: { name: 'inspect_second', arguments: '{}' }
            }
          ]
        },
        {
          role: 'tool',
          toolCallId: 'call_1',
          toolName: 'inspect_first',
          content: 'First window captured.',
          files: [{ dataBase64: 'Zmlyc3Q=', mediaType: 'image/png' }]
        },
        {
          role: 'tool',
          toolCallId: 'call_2',
          toolName: 'inspect_second',
          content: 'Second window captured.'
        }
      ],
      createCompletionParams(null)
    )
    const messages = options['prompt'] as Array<Record<string, unknown>>

    expect(messages[3]).toMatchObject({
      role: 'tool',
      content: [
        { toolCallId: 'call_1' },
        { toolCallId: 'call_2' }
      ]
    })
    expect(messages[4]).toMatchObject({
      role: 'user',
      content: [
        { type: 'text', text: 'Visual evidence returned by inspect_first.' },
        { type: 'file', mediaType: 'image/png' }
      ]
    })
  })

  it('makes malformed historical tool arguments safe for recovery turns', () => {
    const provider = createOpenRouterProvider()
    const malformedArguments = '{"query":"truncated'
    const options = provider.buildCallOptions(
      [
        { role: 'user', content: 'Look up the current value.' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'test__lookup__run',
                arguments: malformedArguments
              }
            }
          ]
        },
        {
          role: 'tool',
          toolCallId: 'call_1',
          toolName: 'test__lookup__run',
          content: 'Tool input rejected: tool_input must be valid JSON.'
        }
      ],
      createCompletionParams(null)
    )
    const messages = options['prompt'] as Array<Record<string, unknown>>
    const assistantMessage = messages[2] as Record<string, unknown>

    expect(assistantMessage['content']).toEqual([
      {
        type: 'tool-call',
        toolCallId: 'call_1',
        toolName: 'test__lookup__run',
        input: {
          invalid_tool_arguments: true,
          raw_arguments: malformedArguments
        }
      }
    ])
  })

  it('streams provider text and clears the draft from a failed attempt', async () => {
    const emit = vi.fn()
    const answerStream = new AgentAnswerStream(emit)
    const onReasoningToken = vi.fn()
    const onStreamEvent = vi.fn()

    answerStream.push('Discard the failed attempt.')

    openRouterMocks.languageModel.doStream.mockResolvedValue({
      response: { headers: { 'x-request-id': 'req-test' } },
      stream: (async function* (): AsyncGenerator<Record<string, unknown>> {
        yield { type: 'response-metadata', id: 'resp-test' }
        yield { type: 'tool-input-delta', id: 'call-test', delta: '{}' }
        yield { type: 'reasoning-delta', delta: 'Thinking' }
        expect(emit).toHaveBeenCalledTimes(2)
        yield { type: 'text-delta', delta: 'Hello' }
        expect(emit).toHaveBeenCalledTimes(3)
        yield { type: 'text-delta', delta: ' world' }
        expect(emit).toHaveBeenCalledTimes(4)
        yield { type: 'finish', finishReason: { unified: 'stop' } }
      })()
    })

    await createOpenRouterProvider().runChatCompletion('Hello.', {
      ...createCompletionParams(null),
      shouldStream: true,
      onToken: (token) => {
        if (typeof token === 'string') answerStream.push(token)
      },
      onReasoningToken,
      onStreamEvent
    })

    expect(onStreamEvent).toHaveBeenCalledWith({
      type: 'stream-open', transport: 'http', requestId: 'req-test'
    })
    expect(onStreamEvent).toHaveBeenCalledWith({
      type: 'response-metadata', responseId: 'resp-test'
    })
    expect(onStreamEvent).toHaveBeenCalledWith({ type: 'tool-input-delta' })
    expect(onReasoningToken).toHaveBeenCalledExactlyOnceWith('Thinking')
    expect(emit).toHaveBeenCalledTimes(4)
    expect(emit.mock.calls[1]![0]).toMatchObject({ reset: true, token: '' })
    answerStream.finish()
    expect(emit).toHaveBeenCalledTimes(4)
    expect(emit).toHaveBeenLastCalledWith({
      token: ' world',
      generationId: expect.any(String)
    })
  })

  it.each([false, true])(
    'retains generated files and never dispatches hosted tools locally (stream=%s)',
    async (streaming) => {
      const parts = [
        {
          type: 'tool-call',
          toolCallId: 'hosted',
          toolName: 'image_generation',
          input: '{}',
          providerExecuted: true
        },
        {
          type: 'file',
          data: new Uint8Array([1, 2, 3]),
          mediaType: 'image/png'
        }
      ]

      openRouterMocks.languageModel.doGenerate.mockResolvedValue({
        content: parts,
        finishReason: { unified: 'stop' }
      })
      openRouterMocks.languageModel.doStream.mockResolvedValue({
        stream: (async function* (): AsyncGenerator<Record<string, unknown>> {
          for (const part of parts) {
            yield part
          }
        })()
      })
      const response = await createOpenRouterProvider().runChatCompletion(
        'Create an image.',
        {
          ...createCompletionParams(null),
          shouldStream: streaming
        }
      )

      expect(mediaMocks.persist).toHaveBeenCalledWith(
        'media-session',
        expect.any(String),
        [
          {
            data: new Uint8Array([1, 2, 3]),
            mime_type: 'image/png',
            filename: 'generated-1.png'
          }
        ]
      )
      const message = (
        response.data['choices'] as Array<{ message: Record<string, unknown> }>
      )[0]!.message

      expect(message['tool_calls']).toBeUndefined()
      expect(message['content']).toContain('image.png')
    }
  )

  it('preserves non-streaming provider accounting', async () => {
    openRouterMocks.languageModel.doGenerate.mockResolvedValue({
      content: [{ type: 'text', text: 'Done.' }],
      usage: { inputTokens: { total: 100, cacheRead: 80 }, outputTokens: { total: 20 } },
      providerMetadata: { openrouter: { usage: { cost: 0.001 } } },
      finishReason: { unified: 'stop' }
    })
    const response = await createOpenRouterProvider().runChatCompletion('Hello.', {
      ...createCompletionParams(null), shouldStream: false
    })
    expect(response.data['usage']).toMatchObject({
      prompt_tokens: 100, completion_tokens: 20,
      accounting: { cachedInputTokens: 80, costUSD: 0.001, costEstimated: false }
    })
  })

  it('preserves streaming length finishes for agent recovery', async () => {
    openRouterMocks.languageModel.doStream.mockResolvedValue({
      stream: (async function* (): AsyncGenerator<Record<string, unknown>> {
        yield {
          type: 'finish',
          finishReason: {
            unified: 'length',
            raw: 'max_tokens'
          },
          usage: {
            inputTokens: { total: 100, cacheRead: 80 },
            outputTokens: { total: 1_024 }
          },
          providerMetadata: { openrouter: { usage: { cost: 0.001 } } }
        }
      })()
    })
    const provider = createOpenRouterProvider()
    const response = await provider.runChatCompletion(
      'Continue.',
      {
        ...createCompletionParams(null),
        shouldStream: true
      }
    )
    const choices = response.data['choices'] as Array<Record<string, unknown>>

    expect(choices[0]?.['finish_reason']).toBe('length')
    expect(response.data['usage']).toMatchObject({
      prompt_tokens: 100,
      accounting: { cachedInputTokens: 80, costUSD: 0.001, costEstimated: false }
    })
  })

  it('uses the dedicated OpenRouter SDK for tool decisions and retains provider reasoning for replay', async () => {
    const actual = await vi.importActual<typeof import('@openrouter/ai-sdk-provider')>('@openrouter/ai-sdk-provider')
    openRouterMocks.createOpenRouter.mockImplementationOnce((...args: unknown[]) =>
      actual.createOpenRouter(args[0] as Parameters<typeof actual.createOpenRouter>[0]) as unknown as
        ReturnType<typeof openRouterMocks.createOpenRouter>
    )
    const reasoningDetails = [{ type: 'reasoning.text', text: 'Inspect the file.', signature: 'signature-1', format: 'anthropic-claude-v1', index: 0 }]
    const fixture = structuredClone(CHAT_RESPONSE)
    const message = { ...fixture.choices[0]!.message, reasoning_details: reasoningDetails }
    const fetch = vi.fn().mockResolvedValue(Response.json({
      ...fixture,
      choices: [{ ...fixture.choices[0], message }]
    }))
    vi.stubGlobal('fetch', fetch)
    const provider = new OpenRouterLLMProvider({ ...TARGET, provider: LLMProviders.OpenRouter, model: 'anthropic/claude-sonnet-5' })

    const response = await provider.runChatCompletion('Read README.md', PARAMS)
    expect(fetch.mock.calls[0]![0]).toMatch(/\/chat\/completions$/)
    expect(response.data.choices[0].message.tool_calls[0].function.name).toBe('read_file')
    expect(response.data.choices[0].message.reasoningItems[0].providerOptions.openrouter.reasoning_details).toEqual(reasoningDetails)
  })

})
