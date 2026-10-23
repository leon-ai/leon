import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResolvedLLMTarget } from '@/core/llm-manager/llm-routing'
import type {
  CompletionParams,
  OpenAIToolCall,
  PromptOrChatHistory
} from '@/core/llm-manager/types'
import { LLMDuties, LLMProviders } from '@/core/llm-manager/types'
import OpenRouterLLMProvider from '@/core/llm-manager/llm-providers/openrouter-llm-provider'
import OpenAILLMProvider from '@/core/llm-manager/llm-providers/openai-llm-provider'
import CelerisLLMProvider from '@/core/llm-manager/llm-providers/celeris-llm-provider'
import MiniMaxLLMProvider from '@/core/llm-manager/llm-providers/minimax-llm-provider'
import { getLLMModelCatalogEntries } from '@/core/llm-manager/llm-model-catalog'
import { prepareCompletionRequest } from '@/core/llm-manager/llm-provider/llm-provider-request'
import ZAILLMProvider from '@/core/llm-manager/llm-providers/z-ai-llm-provider'
import GroqLLMProvider from '@/core/llm-manager/llm-providers/groq-llm-provider'
import DeepSeekLLMProvider from '@/core/llm-manager/llm-providers/deepseek-llm-provider'
import AnthropicLLMProvider from '@/core/llm-manager/llm-providers/anthropic-llm-provider'
import HuggingFaceLLMProvider from '@/core/llm-manager/llm-providers/huggingface-llm-provider'
import AISDKRemoteLLMProvider from '@/core/llm-manager/llm-providers/ai-sdk-remote-llm-provider'
import { ProviderPromptCache } from '@/core/llm-manager/llm-providers/prompt-cache'
import { AGENT_PROMPT_CACHE_KEY } from '@/core/llm-manager/llm-duties/react-llm-duty/agent-constants'
import { runWithProfileContext } from '@/core/profile-runtime/profile-context'
import { readCompletionAccounting } from '@/core/llm-manager/llm-usage/usage-accounting'
import { CONFIG_MANAGER } from '@/config'
import {
  getActiveTurnInference,
  getActiveConversationSessionId,
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
  getActiveConversationSessionId: vi.fn((): string => 'media-session')
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
    getProviderBaseURL: vi.fn(() => null),
    getConfig: vi.fn(() => ({ llm: { model_settings: {} } }))
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

vi.mock('@/core/config-states/config-state', () => ({
  CONFIG_STATE: {
    getModelSettingsState: (): { getSettings: () => { reasoning: string, speed: string } } => ({
      getSettings: () => ({ reasoning: 'auto', speed: 'auto' })
    })
  }
}))

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
    { shouldStream: false, subscription: false },
    { shouldStream: true, subscription: false },
    { shouldStream: true, subscription: true }
  ])('persists and replays automatic compaction (stream=$shouldStream, subscription=$subscription)', async ({ shouldStream, subscription }) => {
    const output = [
      { type: 'compaction', id: 'cmp-old', encrypted_content: 'old-window' },
      { type: 'compaction', id: 'cmp-1', encrypted_content: 'opaque-window' },
      { type: 'reasoning', id: 'rs-retained', encrypted_content: 'opaque-reasoning', summary: [] },
      { type: 'function_call', id: 'fc-retained', call_id: 'call-retained', name: 'read_file', arguments: '{}', status: 'completed'  }
    ]
    const response = {
      id: 'resp-compact', created_at: 1, model: 'gpt-6.1-sol', status: 'completed',
      output, usage: { input_tokens: 100_000, output_tokens: 200, total_tokens: 100_200 }
    }
    const events = [
      { type: 'response.created', response: { ...response, output: [], status: 'in_progress' } },
      ...output.flatMap((item, output_index) => [
        { type: 'response.output_item.added', output_index, item },
        { type: 'response.output_item.done', output_index, item }
      ]),
      { type: 'response.completed', response: subscription ? { ...response, output: [] } : response }
    ]
    if (subscription) {
      vi.spyOn(globalThis, 'fetch').mockImplementation(websocketMocks.fetch)
      accountMocks.getCredentials
        .mockResolvedValueOnce({ auth_kind: 'chatgpt', auth_flow: 'codex', chatgpt_account_id: 'workspace', access_token: 'expired-token' })
        .mockResolvedValue({ auth_kind: 'chatgpt', auth_flow: 'codex', chatgpt_account_id: 'workspace', access_token: 'fresh-token' })
      websocketMocks.fetch.mockResolvedValueOnce(Response.json({}, { status: 401 }))
    }
    websocketMocks.fetch.mockImplementation(async () => shouldStream
      ? new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
          headers: { 'content-type': 'text/event-stream' }
        })
      : Response.json(response))
    const target = {
      ...TARGET, provider: LLMProviders.OpenAI, model: 'gpt-6.1-sol',
      ...(subscription ? { accountCredentials: {
        auth_kind: 'chatgpt', auth_flow: 'codex', chatgpt_account_id: 'workspace', account_id: 'account', access_token: 'expired-token'
      } } : {})
    }
    const provider = new OpenAILLMProvider(target)
    const transcript: PromptOrChatHistory = [{ role: 'user', content: 'Read the file.' }]
    const onStreamEvent = vi.fn()
    const params = { ...PARAMS, dutyType: LLMDuties.ReAct, shouldStream, onStreamEvent }
    const result = await provider.runChatCompletion(transcript, params)
    const normalized = normalizeCompletionResultForOpenAICompatibleProvider(result)
    const context = normalized.compactionContext!
    const body = JSON.parse(websocketMocks.fetch.mock.calls.at(-1)![1].body)

    expect(body.context_management).toEqual([{ type: 'compaction', compact_threshold: 96_000 }])
    expect(body.store).toBe(false)
    expect(context.output).toEqual(output.slice(1))
    expect(context.sourceTranscript[0]).toEqual(transcript[0])
    expect(normalized.toolCalls?.[0]?.id).toBe('call-retained')
    if (shouldStream) {
      expect(onStreamEvent.mock.calls.map(([event]) => event.type).filter((type) =>
        type === 'compaction-start' || type === 'compaction-end'
      )).toEqual([
        'compaction-start', 'compaction-end', 'compaction-start', 'compaction-end'
      ])
    }
    if (subscription) {
      expect(accountMocks.getCredentials).toHaveBeenCalledWith('account', undefined, true)
      expect(new Headers(websocketMocks.fetch.mock.calls.at(-1)![1].headers).get('authorization')).toBe('Bearer fresh-token')
    }

    // Resume through a fresh provider, including tool results after the window.
    const replay = JSON.parse(JSON.stringify([
      { role: 'assistant', content: 'Provider response', toolCalls: normalized.toolCalls, compactionContext: context },
      { role: 'tool', toolCallId: 'call-retained', toolName: 'read_file', content: 'Retained evidence.' }
    ]))
    const resumed = new OpenAILLMProvider(target)
    await resumed.runChatCompletion(replay, params)
    const replayBody = JSON.parse(websocketMocks.fetch.mock.calls.at(-1)![1].body)
    expect(replayBody.input.slice(1, 1 + context.output.length)).toEqual(context.output)
    expect(replayBody.input.at(-1)).toMatchObject({ type: 'function_call_output', call_id: 'call-retained', output: 'Retained evidence.' })
    expect(JSON.stringify(replayBody)).not.toContain('Read the file.')
    expect(JSON.stringify(replayBody)).not.toContain('Provider response')
    expect(replayBody.input.filter((item: Record<string, unknown>) => item['type'] === 'function_call')).toHaveLength(1)
    const next = normalizeCompletionResultForOpenAICompatibleProvider(
      await resumed.runChatCompletion(replay, params)
    ).compactionContext!
    expect(next.sourceTranscript.some((message) => message.role === 'assistant' && message.compactionContext)).toBe(false)
    expect(JSON.stringify(next.sourceTranscript)).toContain('Retained evidence.')
    resumed.dispose()
    provider.dispose()
  })

  it('omits automatic compaction during portable recovery', async () => {
    websocketMocks.fetch.mockResolvedValueOnce(Response.json({
      id: 'resp', created_at: 1, model: 'gpt-6.1-sol', status: 'completed',
      output: [], usage: { input_tokens: 100, output_tokens: 0, total_tokens: 100 }
    }))
    const provider = new OpenAILLMProvider({ ...TARGET, provider: LLMProviders.OpenAI, model: 'gpt-6.1-sol' })
    await provider.runChatCompletion([{ role: 'user', content: 'Continue.' }], {
      ...PARAMS, dutyType: LLMDuties.ReAct, shouldStream: false, disableContextCompaction: true
    })
    expect(JSON.parse(websocketMocks.fetch.mock.calls[0]![1].body).context_management).toBeUndefined()
    provider.dispose()
  })

  it.each(['connection', 'legacy endpoint', 'workspace'])('restores source evidence when compaction belongs to a different %s', async (difference) => {
    websocketMocks.fetch.mockImplementation(async () => new Response(`data: ${JSON.stringify({
      type: 'response.completed', response: {
        id: 'resp_empty', created_at: 1, model: 'gpt-6.1-sol', status: 'completed', output: [],
        usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 }
      }
    })}\n\n`, {
      headers: { 'content-type': 'text/event-stream' }
    }))
    const credentials = {
      auth_kind: 'chatgpt', auth_flow: 'codex', chatgpt_account_id: 'workspace',
      account_id: 'openai.owner', access_token: 'owner-token'
    }
    if (difference !== 'connection') {
      accountMocks.getCredentials.mockResolvedValue(credentials)
      vi.spyOn(globalThis, 'fetch').mockImplementation(websocketMocks.fetch)
    }
    const ownerProvider = new OpenAILLMProvider({
      ...TARGET, provider: LLMProviders.OpenAI, model: 'gpt-6.1-sol',
      ...(difference !== 'connection' ? { accountCredentials: {
        ...credentials,
        chatgpt_account_id: difference === 'workspace' ? 'old-workspace' : 'workspace'
      } } : {})
    })
    if (difference === 'legacy endpoint') {
      // Represents the binding saved before subscription transport migration.
      const previous = ownerProvider as unknown as { config: { baseURL: string } }
      previous.config.baseURL = 'https://api.openai.com/v1'
    }
    const provider = new OpenAILLMProvider({
      ...TARGET, provider: LLMProviders.OpenAI, model: 'gpt-6.1-sol',
      accountCredentials: difference === 'connection' ? { api_key: 'other-key' } : credentials
    })
    await provider.runChatCompletion([{
      role: 'assistant', content: '', compactionContext: {
        provider: LLMProviders.OpenAI, model: 'gpt-6.1-sol',
        binding: ownerProvider.compactionBinding,
        output: [{ type: 'compaction', id: 'cmp-foreign', encrypted_content: 'foreign-window' }],
        estimatedTokens: 100,
        sourceTranscript: [
          { role: 'user', content: 'Exact source request.' },
          {
            role: 'assistant', content: 'Original result.',
            reasoningItems: [{ provider: LLMProviders.OpenAI, id: 'rs-foreign', text: '', encryptedContent: 'foreign-reasoning' }]
          }
        ]
      }
    }], { ...PARAMS, shouldStream: true })

    const body = websocketMocks.fetch.mock.calls[0]![1].body
    expect(body).toContain('Exact source request.')
    expect(body).not.toContain('foreign-window')
    expect(body).not.toContain('foreign-reasoning')
    provider.dispose()
    ownerProvider.dispose()
  })


  it('streams Z.ai before completion and replays exact reasoning with reported cache hits', async () => {
    let controller: ReadableStreamDefaultController<Uint8Array>
    const fetch = vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(streamController): void {
        controller = streamController
      }
    }), { headers: { 'content-type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetch)
    const provider = new ZAILLMProvider({
      provider: LLMProviders.ZAI, model: 'glm-5.3', label: 'Z.ai',
      isEnabled: true, isLocal: false, isResolved: true
    })
    const onToken = vi.fn()
    const onReasoningToken = vi.fn()
    const params = {
      ...createCompletionParams(null), shouldStream: true,
      reasoningMode: 'on' as const, onToken, onReasoningToken
    }
    const pending = provider.runChatCompletion('Check.', params)
    const write = (value: Record<string, unknown>): void => {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`))
    }
    for (const reasoning of ['  ', 'check ', 'check ', '\n']) {
      write({ choices: [{ delta: { reasoning_content: reasoning } }] })
    }
    write({ choices: [{ delta: { content: 'Done.' } }] })
    await vi.waitFor(() => {
      expect(onToken).toHaveBeenCalledWith('Done.')
      expect(onReasoningToken.mock.calls.map(([chunk]) => chunk).join('')).toBe('  check check \n')
    })
    write({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: {
      prompt_tokens: 1_000, completion_tokens: 20,
      prompt_tokens_details: { cached_tokens: 512 },
      completion_tokens_details: { reasoning_tokens: 15 }
    } })
    controller!.close()
    const normalized = normalizeCompletionResultForOpenAICompatibleProvider(await pending)
    expect(normalized.accounting).toMatchObject({ cachedInputTokens: 512, reasoningOutputTokens: 15 })
    const reasoningItems = normalized.reasoningItems!
    expect(reasoningItems[0]!.text).toBe('  check check \n')

    fetch.mockResolvedValue(new Response(
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
    ))
    await provider.runChatCompletion([
      { role: 'user', content: 'Check.' },
      { role: 'assistant', content: '', reasoningItems,
        toolCalls: [{ id: 'call_1', type: 'function', function: { name: 'check', arguments: '{}' } }] },
      { role: 'tool', toolCallId: 'call_1', toolName: 'check', content: 'Checked.' }
    ], params)
    const body = JSON.parse(fetch.mock.calls[1]![1].body)
    expect(body).toMatchObject({
      stream: true,
      thinking: { type: 'enabled', clear_thinking: false }
    })
    expect(body.messages).toContainEqual(expect.objectContaining({
      role: 'assistant', reasoning_content: '  check check \n'
    }))
  })

  it.each([
    'required' as const,
    { type: 'function' as const, function: { name: 'check' } }
  ])('adapts Z.ai tool-action intent to automatic selection (%j)', async (toolChoice) => {
    const fetch = vi.fn().mockImplementation(async () => Response.json({
      id: 'chat_zai', model: 'glm-5.3', created: 1,
      choices: [{ index: 0, finish_reason: 'tool_calls', message: {
        role: 'assistant', content: '',
        tool_calls: [{ id: 'call_check', type: 'function', function: { name: 'check', arguments: '{}' } }]
      } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 80 } }
    }))
    vi.stubGlobal('fetch', fetch)
    const provider = new ZAILLMProvider({
      provider: LLMProviders.ZAI, model: 'glm-5.3', label: 'Z.ai',
      isEnabled: true, isLocal: false, isResolved: true,
      accountCredentials: {
        api_key: 'coding-key', base_url: 'https://example.invalid/api/coding/paas/v4'
      }
    })
    const prompt: PromptOrChatHistory = [{ role: 'user', content: 'Check.' }]
    const params: CompletionParams = {
      ...createCompletionParams(null), shouldStream: false, toolChoice,
      reasoningMode: 'on', reasoningEffort: 'max',
      tools: ['check', 'other'].map((name) => ({
        type: 'function', function: { name, parameters: { type: 'object', properties: {} } }
      }))
    }
    const result = normalizeCompletionResultForOpenAICompatibleProvider(
      await provider.runChatCompletion(prompt, params)
    )
    const body = JSON.parse(fetch.mock.calls[0]![1].body)

    expect(String(fetch.mock.calls[0]![0])).toBe('https://example.invalid/api/coding/paas/v4/chat/completions')
    expect(new Headers(fetch.mock.calls[0]![1].headers).get('authorization')).toBe('Bearer coding-key')
    expect(body).toMatchObject({
      tool_choice: 'auto', reasoning_effort: 'max', thinking: { type: 'enabled', clear_thinking: false }
    })
    expect(body.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual(
      toolChoice === 'required' ? ['check', 'other'] : ['check']
    )
    expect(body.messages[0]).toEqual({ role: 'system', content: params.systemPrompt })
    expect(body.messages.at(-1)).toMatchObject({
      role: 'user', content: expect.stringContaining('calling one of the available tools')
    })
    expect(prompt).toEqual([{ role: 'user', content: 'Check.' }])
    expect(result.toolCalls?.[0]?.function.name).toBe('check')
    expect(result.accounting?.cachedInputTokens).toBe(80)

    await provider.runChatCompletion(prompt, { ...params, toolChoice: 'none', reasoningMode: 'off' })
    const finalization = JSON.parse(fetch.mock.calls[1]![1].body)
    expect(finalization.tools).toBeUndefined()
    expect(finalization.reasoning_effort).toBe('low')
    expect(finalization.messages.at(-1)).toEqual({ role: 'user', content: 'Check.' })
  })

  it.each([
    [LLMProviders.ZAI, 'zai', 'glm-5.3'],
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
    const fetch = vi.fn().mockResolvedValue(new Response(
      events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } }
    ))
    vi.stubGlobal('fetch', fetch)
    const provider = new AISDKRemoteLLMProvider({
      name, providerName: name, model, flavor, apiKeyEnv: 'TEST_KEY', baseURL: 'https://example.invalid/v1'
    })
    const onToken = vi.fn()
    const response = await provider.runChatCompletion('Answer.', {
      ...createCompletionParams(null),
      shouldStream: true,
      onToken,
      promptCacheKey: 'agent',
      ...(name === LLMProviders.Groq
        ? { seed: 7, reasoningMode: 'off' as const }
        : {})
    })
    const normalized = normalizeCompletionResultForOpenAICompatibleProvider(response)
    expect(onToken.mock.calls.map(([chunk]) => chunk).join('')).toBe('Yes Yes ')
    expect(normalized).toMatchObject({
      usedInputTokens: 100, usedOutputTokens: 20, accounting: { cachedInputTokens: 80 }
    })

    if (name === LLMProviders.Cerebras) {
      const body = JSON.parse(fetch.mock.calls[0]![1].body)
      expect(body.prompt_cache_key).toBe('media-session')
    }

    if (name === LLMProviders.Groq) {
      const body = JSON.parse(fetch.mock.calls[0]![1].body)
      expect(body.reasoning_effort).toBeUndefined()
      expect(body.reasoning_format).toBe('hidden')
    }
  })

  it.each([
    { protocol: 'anthropic', model: 'MiniMax-M3' },
    { protocol: 'openai', model: 'MiniMax-M3' },
    { protocol: 'anthropic', model: 'MiniMax-M3.1-Flash' },
    { protocol: 'openai', model: 'MiniMax-M3.1-Flash' }
  ])('preserves MiniMax connection media, reasoning controls and cache usage (%j)', async ({ protocol, model }) => {
    const baseURL = protocol === 'anthropic'
      ? 'https://example.invalid/anthropic'
      : 'https://example.invalid/v1'
    const fetch = vi.fn().mockImplementation(async () => Response.json(
      protocol === 'anthropic'
        ? {
            id: 'msg_minimax', type: 'message', role: 'assistant', model,
            content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn', stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 80, cache_creation_input_tokens: 10 }
          }
        : {
            id: 'chat_minimax', created: 1, model,
            choices: [{ index: 0, message: { role: 'assistant', content: 'Done.' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 100, completion_tokens: 2,
              prompt_tokens_details: { cached_tokens: 80, cache_write_tokens: 10 } }
          }
    ))
    vi.stubGlobal('fetch', fetch)
    const provider = new MiniMaxLLMProvider({
      provider: LLMProviders.MiniMax, model, label: 'MiniMax',
      isEnabled: true, isLocal: false, isResolved: true,
      accountCredentials: { api_key: 'minimax-account-key', base_url: baseURL }
    })
    const prompt: PromptOrChatHistory = [{
      role: 'user', content: 'Look.', files: [{ mediaType: 'image/png', dataBase64: 'AA==' }]
    }]
    const params: CompletionParams = {
      ...createCompletionParams(null), shouldStream: false, reasoningMode: 'on',
      ...(model === 'MiniMax-M3.1-Flash' ? { reasoningEffort: 'xhigh' } : {})
    }
    const normalized = normalizeCompletionResultForOpenAICompatibleProvider(
      await provider.runChatCompletion(prompt, params)
    )
    const body = JSON.parse(fetch.mock.calls[0]![1].body)
    const content = body.messages.find((message: { role: string }) => message.role === 'user').content

    expect(normalized).toMatchObject({
      usedInputTokens: 100, usedOutputTokens: 2,
      accounting: { cachedInputTokens: 80, cacheWriteInputTokens: 10 }
    })
    expect(body.thinking).toEqual({ type: 'adaptive' })
    if (model === 'MiniMax-M3.1-Flash') {
      expect(protocol === 'anthropic' ? body.output_config.effort : body.reasoning_effort)
        .toBe('xhigh')
    }
    if (protocol === 'anthropic') {
      expect(String(fetch.mock.calls[0]![0])).toBe(`${baseURL}/v1/messages`)
      expect(content).toContainEqual({
        type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA==' }
      })
    } else {
      expect(String(fetch.mock.calls[0]![0])).toBe(`${baseURL}/chat/completions`)
      expect(body.reasoning_split).toBe(true)
      expect(new Headers(fetch.mock.calls[0]![1].headers).get('authorization')).toBe('Bearer minimax-account-key')
      expect(content).toContainEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } })
    }

    await provider.runChatCompletion(prompt, { ...params, reasoningMode: 'off', disableThinking: true })
    const guardedBody = JSON.parse(fetch.mock.calls[1]![1].body)
    expect(guardedBody.thinking).toEqual({
      type: model === 'MiniMax-M3.1-Flash' ? 'adaptive' : 'disabled'
    })
    if (model === 'MiniMax-M3.1-Flash') {
      expect(protocol === 'anthropic' ? guardedBody.output_config.effort : guardedBody.reasoning_effort)
        .toBe('low')
    }
  })

  it.each(['https://api.minimax.io', 'https://api.minimaxi.com'])(
    'sends current, saved and custom MiniMax IDs unchanged through %s', async (host) => {
    const models = [
      getLLMModelCatalogEntries(LLMProviders.MiniMax)[0]!.model,
      'MiniMax-M3', 'MiniMax-M2.7', 'my-custom-model'
    ]
    for (const protocol of ['openai', 'anthropic']) {
      for (const model of models) {
        const fetch = vi.fn().mockImplementation(async () => Response.json(
          protocol === 'anthropic'
            ? {
                id: 'msg_minimax', type: 'message', role: 'assistant', model,
                content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn', stop_sequence: null,
                usage: { input_tokens: 10, output_tokens: 2 }
              }
            : {
                id: 'chat_minimax', created: 1, model,
                choices: [{ index: 0, message: { role: 'assistant', content: 'Done.' }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 10, completion_tokens: 2 }
              }
        ))
        vi.stubGlobal('fetch', fetch)
        const target = {
          provider: LLMProviders.MiniMax, model, label: 'MiniMax',
          isEnabled: true, isLocal: false, isResolved: true,
          accountCredentials: {
            api_key: 'fixture-key',
            base_url: `${host}/${protocol === 'anthropic' ? 'anthropic' : 'v1'}`
          }
        }
        const provider = new MiniMaxLLMProvider(target)
        const params: CompletionParams = {
          ...createCompletionParams(null), shouldStream: false, tools: [TOOL],
          toolChoice: 'auto', reasoningMode: 'on'
        }
        prepareCompletionRequest(params, LLMProviders.MiniMax, target)
        await provider.runChatCompletion('Continue.', params)
        const [url, request] = fetch.mock.calls[0]!
        const body = JSON.parse(request.body)
        expect(String(url)).toBe(`${host}/${protocol === 'anthropic' ? 'anthropic/v1/messages' : 'v1/chat/completions'}`)
        expect(body.model).toBe(model)
        expect(body.tools).toHaveLength(1)
        expect(body.service_tier).toBeUndefined()
        const headers = new Headers(request.headers)
        expect(headers.get(protocol === 'anthropic' ? 'x-api-key' : 'authorization'))
          .toBe(protocol === 'anthropic' ? 'fixture-key' : 'Bearer fixture-key')
        if (model === 'MiniMax-M3.1-Flash') {
          expect(body.thinking).toEqual({ type: 'adaptive' })
          expect(protocol === 'anthropic' ? body.output_config.effort : body.reasoning_effort).toBe('max')
        } else if (model === 'MiniMax-M2.7' || model === 'my-custom-model') {
          expect(body.thinking).toBeUndefined()
          expect(body.reasoning_effort).toBeUndefined()
          expect(body.output_config).toBeUndefined()
        }
        provider.dispose()
      }
    }
  })

  it('distinguishes unavailable cache accounting from a reported zero', () => {
    const inputTokens = { total: 100, cacheRead: 0, cacheWrite: 0 }
    expect(readCompletionAccounting({ inputTokens, raw: { prompt_tokens: 100 } })).toEqual({})
    expect(readCompletionAccounting({ inputTokens, raw: {
      prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 0 }
    } })).toEqual({ cachedInputTokens: 0 })
  })

  it.each([
    { ttl: undefined, model: 'gpt-6.1-sol', subscription: false, enabled: true },
    { ttl: '30m', model: 'gpt-6.1-sol', subscription: false, enabled: false },
    { ttl: '12h', model: 'gpt-6.1-sol', subscription: false, enabled: true },
    { ttl: '12h', model: 'gpt-5.5', subscription: false, enabled: false },
    { ttl: '12h', model: 'gpt-6.1-sol', subscription: true, enabled: false }
  ] as const)('defaults to mixed caching for supported API agents and respects overrides (%j)', async ({ ttl, model, subscription, enabled }) => {
    vi.mocked(CONFIG_MANAGER.getConfig).mockReturnValue({
      llm: { model_settings: { [`openai/${model}`]: { instructions_cache_ttl: ttl } } }
    } as ReturnType<typeof CONFIG_MANAGER.getConfig>)

    if (subscription) {
      vi.spyOn(globalThis, 'fetch').mockImplementation(websocketMocks.fetch)
      accountMocks.getCredentials.mockResolvedValue({
        auth_kind: 'chatgpt', auth_flow: 'codex',
        access_token: 'fixture-token', chatgpt_account_id: 'workspace'
      })
    }

    const usage = {
      input_tokens: 12_000, output_tokens: 10,
      input_tokens_details: {
        cached_tokens: 4_000, cache_write_tokens: 7_000,
        cache_write_tokens_details: { ttl_30m_tokens: 3_000, ttl_12h_tokens: 4_000 }
      }
    }
    const response = {
      id: 'resp-cache', created_at: 1, model, status: 'completed', output: [], usage
    }
    websocketMocks.fetch.mockImplementation(async () => new Response(
      `data: ${JSON.stringify({ type: 'response.completed', response })}\n\n`,
      { headers: { 'content-type': 'text/event-stream' } }
    ))
    const provider = new OpenAILLMProvider({
      ...TARGET, provider: LLMProviders.OpenAI, model,
      ...(subscription ? { accountCredentials: {
        auth_kind: 'chatgpt', account_id: 'account', access_token: 'fixture-token'
      } } : {})
    })
    const transcript: PromptOrChatHistory = [
      { role: 'user', content: 'Current owner request.' },
      { role: 'user', content: 'Current clock and mood.' }
    ]
    const params = {
      ...PARAMS, promptCacheKey: AGENT_PROMPT_CACHE_KEY, shouldStream: true
    }
    const result = await provider.runChatCompletion(transcript, params)
    const body = JSON.parse(websocketMocks.fetch.mock.calls.at(-1)![1].body)

    expect(body.input.slice(1)).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'Current owner request.' }] },
      { role: 'user', content: [{ type: 'input_text', text: 'Current clock and mood.' }] }
    ])
    expect(body.tools[0].name).toBe(TOOL.function.name)

    if (enabled) {
      expect(body.prompt_cache_options).toEqual({ mode: 'implicit', ttl: '30m' })
      expect(body.input[0]).toEqual({
        role: 'developer',
        content: [{
          type: 'input_text', text: PARAMS.systemPrompt,
          prompt_cache_breakpoint: { mode: 'explicit', ttl: '12h' }
        }]
      })

      await provider.runChatCompletion(transcript, { ...params, systemPrompt: 'Updated rules.' })
      const updated = JSON.parse(websocketMocks.fetch.mock.calls.at(-1)![1].body)
      expect(updated.input[0].content[0].text).toBe('Updated rules.')
      expect(updated.prompt_cache_key).toBe(body.prompt_cache_key)
    } else {
      expect(body.prompt_cache_options).toBeUndefined()
      expect(JSON.stringify(body.input)).not.toContain('prompt_cache_breakpoint')
    }

    expect(normalizeCompletionResultForOpenAICompatibleProvider(result).accounting).toMatchObject({
      cachedInputTokens: 4_000, cacheWriteInputTokens: 7_000,
      cacheWrite30mInputTokens: 3_000, cacheWrite12hInputTokens: 4_000
    })
    provider.dispose()
  })

  it('preserves reasoning, tool images and cache usage on DeepSeek schema Responses', async () => {
    const reasoning = { type: 'reasoning', id: 'rs_deepseek', summary: [],
      content: [{ type: 'reasoning_text', text: '  inspect inspect \n' }] }
    const call = { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'inspect', arguments: '{}' }
    const response = { id: 'resp_deepseek', created_at: 1, model: 'deepseek-flash', status: 'completed',
      output: [reasoning, call], usage: { input_tokens: 100, output_tokens: 20,
        input_tokens_details: { cached_tokens: 80 }, output_tokens_details: { reasoning_tokens: 15 } } }
    const events = [
      { type: 'response.created', response: { ...response, output: [], status: 'in_progress' } },
      { type: 'response.output_item.added', output_index: 0, item: { ...reasoning, content: [] } },
      { type: 'response.reasoning_text.delta', item_id: reasoning.id, output_index: 0, delta: '  inspect ' },
      { type: 'response.reasoning_text.delta', item_id: reasoning.id, output_index: 0, delta: 'inspect \n' },
      { type: 'response.output_item.done', output_index: 0, item: reasoning },
      { type: 'response.output_item.added', output_index: 1, item: { ...call, arguments: '' } },
      { type: 'response.function_call_arguments.delta', item_id: call.id, output_index: 1, delta: '{}' },
      { type: 'response.output_item.done', output_index: 1, item: call },
      { type: 'response.completed', response }
    ]
    const fetch = vi.fn().mockImplementation(async () => new Response(
      events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
      { headers: { 'content-type': 'text/event-stream' } }
    ))
    vi.stubGlobal('fetch', fetch)
    const provider = new DeepSeekLLMProvider({
      provider: LLMProviders.DeepSeek, model: response.model, label: 'DeepSeek',
      isEnabled: true, isLocal: false, isResolved: true
    })
    const params = {
      ...createCompletionParams({ inspected: { type: 'boolean' } }),
      shouldStream: true,
      reasoningMode: 'on' as const
    }
    const normalized = normalizeCompletionResultForOpenAICompatibleProvider(
      await provider.runChatCompletion('Inspect.', params)
    )
    expect(String(fetch.mock.calls[0]![0])).toBe('https://api.deepseek.com/v1/responses')
    expect(normalized).toMatchObject({
      accounting: { cachedInputTokens: 80, reasoningOutputTokens: 15 },
      toolCalls: [{ id: 'call_1', function: { name: 'inspect' } }],
      reasoningItems: [{ provider: LLMProviders.DeepSeek, id: reasoning.id, text: '  inspect inspect \n' }]
    })
    await provider.runChatCompletion([
      { role: 'user', content: 'Inspect.' },
      { role: 'assistant', content: '', reasoningItems: normalized.reasoningItems, toolCalls: normalized.toolCalls },
      { role: 'tool', toolName: 'inspect', toolCallId: 'call_1', content: 'Screenshot.',
        files: [{ dataBase64: 'aW1hZ2U=', mediaType: 'image/png', visualDetail: 'low' }] }
    ], { ...params, toolChoice: 'required' })
    const body = JSON.parse(fetch.mock.calls[1]![1].body)
    expect(body).toMatchObject({ reasoning: { effort: 'none' }, tool_choice: 'required' })
    expect(body.input).toContainEqual(reasoning)
    expect(body.input).toContainEqual({
      type: 'function_call_output', call_id: 'call_1', output: [
        { type: 'input_text', text: 'Screenshot.' },
        { type: 'input_image', image_url: 'data:image/png;base64,aW1hZ2U=', detail: 'low' }
      ]
    })
    expect(body.previous_response_id).toBeUndefined()
  })

  it('retains Hugging Face function calls and outputs in Responses history', async () => {
    const response = { id: 'resp_hf', created_at: 1, model: 'openai/gpt-oss-120b', status: 'completed',
      output: [{ type: 'function_call', call_id: 'call_hf', name: 'lookup', arguments: '{}' }],
      usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 80 } } }
    const fetch = vi.fn().mockImplementation(async () => Response.json(response))
    vi.stubGlobal('fetch', fetch)
    const provider = new HuggingFaceLLMProvider({
      provider: LLMProviders.HuggingFace, model: response.model, label: 'HF',
      isEnabled: true, isLocal: false, isResolved: true
    })
    const params = { ...createCompletionParams(null), shouldStream: false }
    const normalized = normalizeCompletionResultForOpenAICompatibleProvider(
      await provider.runChatCompletion('Lookup.', params)
    )
    expect(normalized.accounting?.cachedInputTokens).toBe(80)
    await provider.runChatCompletion([
      { role: 'user', content: 'Lookup.' },
      { role: 'assistant', content: '', toolCalls: normalized.toolCalls },
      { role: 'tool', toolCallId: 'call_hf', toolName: 'lookup', content: 'Found.' }
    ], { ...params, toolChoice: 'none' })
    expect(String(fetch.mock.calls[1]![0])).toBe('https://router.huggingface.co/v1/responses')
    const body = JSON.parse(fetch.mock.calls[1]![1].body)
    expect(body.input).toContainEqual({
      type: 'function_call', call_id: 'call_hf', name: 'lookup', arguments: '{}'
    })
    expect(body.input).toContainEqual({ type: 'function_call_output', call_id: 'call_hf', output: 'Found.' })
    expect(body.tool_choice).toBe('none')
  })

  it.each([
    {
      model: 'claude-haiku-4-5',
      thinking: { type: 'enabled', budget_tokens: 2_048 },
      effort: undefined,
      temperature: 0.5
    },
    {
      model: 'claude-haiku-5-5',
      thinking: { type: 'adaptive', display: 'summarized' },
      effort: 'medium',
      temperature: undefined
    }
  ])('uses supported thinking and sampling for $model', async ({
    model,
    thinking,
    effort,
    temperature
  }) => {
    const fetch = vi.fn().mockResolvedValue(Response.json({
      id: 'msg_haiku',
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'text', text: 'Done.' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 2 }
    }))
    const provider = new AnthropicLLMProvider({
      ...TARGET,
      provider: LLMProviders.Anthropic,
      model
    })
    const params = {
      ...PARAMS,
      reasoningEffort: 'medium' as const,
      thoughtTokensBudget: 2_048,
      temperature: 0.5
    }
    const options = (
      provider as unknown as ProviderWithPrivateCallOptions
    ).buildCallOptions('Check.', params)

    expect(options['temperature']).toBe(temperature)

    vi.stubGlobal('fetch', fetch)

    await provider.runChatCompletion('Check.', params)

    const body = JSON.parse(fetch.mock.calls[0]![1].body)

    expect(body.thinking).toEqual(thinking)
    expect(body.output_config?.effort).toBe(effort)
    expect(body.temperature).toBeUndefined()
  })

  it.each(['off', 'required'] as const)(
    'allows Haiku 5.5 requests with %s thinking or tool choice',
    (mode) => {
      const provider = new AnthropicLLMProvider({
        ...TARGET,
        provider: LLMProviders.Anthropic,
        model: 'claude-haiku-5-5'
      }) as unknown as ProviderWithPrivateCallOptions
      const options = provider.buildCallOptions('Read the file.', {
        ...PARAMS,
        reasoningMode: mode === 'off' ? 'off' : 'on',
        reasoningEffort: 'max',
        toolChoice: mode === 'required' ? 'required' : 'auto'
      })

      expect(options['providerOptions']).toEqual({
        anthropic: {
          thinking: { type: 'disabled' },
          sendReasoning: true
        }
      })
      expect(options['toolChoice']).toEqual({
        type: mode === 'required' ? 'required' : 'auto'
      })
    }
  )

  it.each([LLMProviders.Anthropic, LLMProviders.MiniMax])('preserves %s cache accounting and signed thinking through streamed tool turns', async (providerName) => {
    const model = providerName === LLMProviders.Anthropic ? 'claude-opus-5-5' : 'MiniMax-M3.1-Flash'
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
    expect(body).toMatchObject({
      provider: { sort: 'throughput' },
      session_id: 'media-session',
      cache_control: { type: 'ephemeral' }
    })
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
    expect(minimax.config).toMatchObject({ baseURL: 'https://api.minimax.io/anthropic/v1', flavor: 'minimax' })
  })

  it('isolates cache identities and reports changes to the final request prefix without retaining content', () => {
    const cache = new ProviderPromptCache()
    const template = {
      model: 'gpt-6.1-sol', prompt_cache_key: 'agent',
      instructions: 'Private system instructions.',
      tools: [{ type: 'function', name: 'read_note' }],
      input: [{ role: 'user', content: 'Private owner request.' }]
    }
    const request = (): typeof template => structuredClone(template)
    const initial = runWithProfileContext({ profileName: 'first' }, () =>
      cache.prepare(request(), 'first-account')
    )
    const continued = request()
    continued.input.push({ role: 'assistant', content: 'Verified result.' })
    const warm = runWithProfileContext({ profileName: 'first' }, () =>
      cache.prepare(continued, 'first-account')
    )

    expect(warm.observation).toMatchObject({
      key: initial.observation!.key,
      previousInputItems: 1, matchingPrefixItems: 1, changedInputs: []
    })

    continued.prompt_cache_key = 'agent'
    continued.tools.push({ type: 'function', name: 'write_note' })
    continued.input[0]!.content = 'Edited owner request.'
    const changed = runWithProfileContext({ profileName: 'first' }, () =>
      cache.prepare(continued, 'first-account')
    )

    expect(changed.observation).toMatchObject({
      key: initial.observation!.key, matchingPrefixItems: 0,
      changedInputs: ['tools', 'history']
    })
    expect(runWithProfileContext({ profileName: 'second' }, () =>
      cache.prepare(request(), 'first-account').observation?.key
    )).not.toBe(initial.observation!.key)
    expect(runWithProfileContext({ profileName: 'first' }, () =>
      cache.prepare(request(), 'second-account').observation?.key
    )).not.toBe(initial.observation!.key)
    vi.mocked(getActiveConversationSessionId).mockReturnValueOnce('another-session')
    expect(runWithProfileContext({ profileName: 'first' }, () =>
      cache.prepare(request(), 'first-account').observation?.key
    )).not.toBe(initial.observation!.key)
    expect(JSON.stringify(changed)).not.toContain('Private')
    expect(JSON.stringify(changed)).not.toContain('first-account')
  })

  it('shares instruction prefixes across sessions while keeping profile, binding and observations isolated', () => {
    const cache = new ProviderPromptCache()
    const request = (): Record<string, unknown> => {
      return {
        model: 'gpt-6.1-sol', prompt_cache_key: AGENT_PROMPT_CACHE_KEY,
        input: [{ role: 'developer', content: 'Stable instructions.' }]
      }
    }
    const prepare = (
      profile = 'owner',
      binding = 'account'
    ): ReturnType<ProviderPromptCache['prepare']> => {
      return runWithProfileContext({ profileName: profile }, () =>
        cache.prepare(request(), binding, false, 'agent', true)
      )
    }
    const first = prepare()
    vi.mocked(getActiveConversationSessionId).mockReturnValueOnce('another-session')
    const otherSession = prepare()

    expect(otherSession.observation?.key).toBe(first.observation?.key)
    expect(otherSession.observation?.previousInputItems).toBe(0)
    expect(prepare().observation?.previousInputItems).toBe(1)
    expect(prepare('other-owner').observation?.key).not.toBe(first.observation?.key)
    expect(prepare('owner', 'other-account').observation?.key).not.toBe(first.observation?.key)
  })

  it.each(['messages', 'input'])('observes %s without mutating provider requests or misclassifying appended instructions', (field) => {
    const cache = new ProviderPromptCache()
    const body: Record<string, unknown> = {
      model: 'model', system: 'Stable rules.',
      tools: [
        { type: 'function', function: { name: 'read', parameters: {} } },
        { type: 'function', function: { name: 'write', parameters: {} } }
      ],
      [field]: [{ role: 'user', content: 'Inspect the workspace.' }]
    }
    const original = JSON.stringify(body)
    const first = cache.prepare(body, 'account', true)
    expect(JSON.stringify(body)).toBe(original)

    const continued = structuredClone(body)
    ;(continued[field] as unknown[]).push({ role: 'developer', content: 'Current runtime state.' })
    expect(cache.prepare(continued, 'account', true).observation).toMatchObject({
      systemHash: first.observation!.systemHash,
      matchingPrefixItems: 1, changedInputs: []
    })

    ;(continued['tools'] as unknown[]).reverse()
    expect(cache.prepare(continued, 'account', true).observation).toMatchObject({
      changedInputs: ['tools'],
      toolChanges: { added: 0, removed: 0, modified: 0, reordered: true }
    })

    continued['tools'] = [{ type: 'function', function: { name: 'read', parameters: { changed: true } } }]
    expect(cache.prepare(continued, 'account', true).observation).toMatchObject({
      toolChanges: { added: 0, removed: 1, modified: 1, reordered: false }
    })
    expect(JSON.stringify(first.observation)).not.toContain('Stable rules.')
  })

  it('preserves subscription streaming, cache usage, summaries and encrypted reasoning for replay', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(websocketMocks.fetch)
    accountMocks.getCredentials.mockResolvedValue({ auth_kind: 'chatgpt', auth_flow: 'codex', chatgpt_account_id: 'workspace', access_token: 'fresh-chatgpt-token' })
    const call = { type: 'function_call', id: 'fc_test', call_id: 'call_test',
      name: 'read_note', namespace: 'leon', arguments: '{ "name": "todo" }', status: 'completed' }
    const reasoning = {
      type: 'reasoning',
      id: 'rs_test',
      encrypted_content: 'encrypted-test',
      summary: [{ type: 'summary_text', text: 'Checking the note.' }]
    }
    const message = {
      type: 'message', id: 'msg_progress', role: 'assistant', phase: 'commentary',
      status: 'completed',
      content: [{ type: 'output_text', text: 'Checking your note.', annotations: [] }]
    }
    const response = { id: 'resp_test', created_at: 1, model: 'gpt-6.1-sol',
      status: 'completed', output: [reasoning, message, call], usage: {
        input_tokens: 1_536, output_tokens: 24, total_tokens: 1_560,
        input_tokens_details: { cached_tokens: 1_024 }, output_tokens_details: { reasoning_tokens: 10 }
      } }
    const events = [
      { type: 'response.created', response: { ...response, output: [], status: 'in_progress' } },
      { type: 'response.output_item.added', output_index: 0, item: { ...reasoning, summary: [] } },
      { type: 'response.reasoning_summary_text.delta', item_id: reasoning.id, output_index: 0,
        summary_index: 0, delta: 'Checking the note.' },
      { type: 'response.output_item.done', output_index: 0, item: reasoning },
      { type: 'response.output_item.added', output_index: 1, item: { ...message, content: [] } },
      { type: 'response.output_text.delta', item_id: message.id, output_index: 1, content_index: 0, delta: 'Checking your note.' },
      { type: 'response.output_item.done', output_index: 1, item: message },
      { type: 'response.output_item.added', output_index: 2, item: { ...call, arguments: '', status: 'in_progress' } },
      { type: 'response.function_call_arguments.delta', item_id: call.id, output_index: 2, delta: call.arguments },
      { type: 'response.output_item.done', output_index: 2, item: call },
      { type: 'response.completed', response }
    ]
    websocketMocks.fetch.mockImplementation(async () => new Response(
      `: keep-alive\n\n${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}`,
      { headers: { 'content-type': 'text/event-stream' } }
    ))
    const provider = new OpenAILLMProvider({
      provider: LLMProviders.OpenAI, model: response.model, label: `openai/${response.model}`,
      isEnabled: true, isLocal: false, isResolved: true,
      accountCredentials: { auth_kind: 'chatgpt', auth_flow: 'codex', chatgpt_account_id: 'workspace', access_token: 'old-chatgpt-token', account_id: 'openai.test' }
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
      endpoint: 'https://chatgpt.com/backend-api/codex/responses'
    })
    expect(JSON.stringify(inference)).not.toContain('openai.test')
    expect(JSON.stringify(inference)).not.toContain('chatgpt-token')
    expect(getActiveTurnInference()).toBeUndefined()

    const [url, request] = websocketMocks.fetch.mock.calls[0]!
    expect(String(url)).toBe('https://chatgpt.com/backend-api/codex/responses')
    expect(new Headers(request?.headers).get('authorization')).toBe('Bearer fresh-chatgpt-token')
    const body = JSON.parse(request?.body as string)
    expect(body).toMatchObject({ stream: true, store: false, tools: [{ type: 'function', name: 'read_note' }] })
    expect(new Headers(request?.headers).get('chatgpt-account-id')).toBe('workspace')
    expect(body.temperature).toBeUndefined()
    expect(body.input[0].role).toBe('developer')
    expect(body).toMatchObject({
      reasoning: { effort: 'medium', summary: 'auto' },
      include: ['reasoning.encrypted_content'], prompt_cache_key: expect.stringMatching(/^leon-[a-f0-9]{48}$/)
    })
    expect(result.data.choices[0].message.tool_calls[0].function.name).toBe('read_note')
    expect(onReasoningToken).toHaveBeenCalledWith('Checking the note.')
    expect(provider.transport).toBe('http')
    expect(onStreamEvent.mock.calls.filter(([event]) => event.type !== 'prompt-cache').slice(0, 3).map(([event]) => event)).toEqual([
      { type: 'request-dispatched', transport: 'http' },
      { type: 'response-headers', transport: 'http' },
      { type: 'transport-activity', transport: 'http' }
    ])
    expect(onStreamEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'stream-open', transport: 'http'
    }))
    expect(onStreamEvent).toHaveBeenCalledWith({
      type: 'transport-activity', transport: 'http'
    })
    const normalized = normalizeCompletionResultForOpenAICompatibleProvider(result)
    expect(normalized.accounting?.cachedInputTokens).toBe(1_024)
    expect(normalized.accounting?.reasoningOutputTokens).toBe(10)
    expect(normalized.reasoningItems).toEqual([{
      provider: LLMProviders.OpenAI, id: 'rs_test', text: 'Checking the note.',
      encryptedContent: 'encrypted-test', binding: provider.compactionBinding
    }])

    await provider.runChatCompletion([
      { role: 'user', content: 'Read my note.' },
      { role: 'assistant', content: normalized.rawResult, toolCalls: normalized.toolCalls,
        reasoningItems: normalized.reasoningItems, providerMessage: normalized.providerMessage },
      { role: 'tool', toolName: 'read_note', toolCallId: 'call_test', content: 'Note contents.' }
    ], params)
    const replay = JSON.parse(websocketMocks.fetch.mock.calls[1]![1].body)
    expect(replay.input).toContainEqual(reasoning)
    expect(replay.input).toContainEqual({ role: 'assistant', content: 'Checking your note.', phase: 'commentary' })
    expect(replay.input).toContainEqual(expect.objectContaining({
      type: 'function_call', call_id: call.call_id, arguments: call.arguments
    }))
    expect(replay.prompt_cache_key).toBe(body.prompt_cache_key)
    expect(new Headers(request?.headers).get('session_id')).toBe('media-session')
    expect(new Headers(request?.headers).get('x-client-request-id')).toBe(body.prompt_cache_key)
    const cacheEvents = onStreamEvent.mock.calls.filter(([event]) => event.type === 'prompt-cache')
    expect(cacheEvents.at(-1)?.[0].promptCache).toMatchObject({
      previousInputItems: body.input.length, matchingPrefixItems: body.input.length,
      changedInputs: [], inputTokens: 1_536, cachedInputTokens: 1_024
    })
    expect(websocketMocks.create).not.toHaveBeenCalled()
    expect(accountMocks.getCredentials).toHaveBeenCalledWith('openai.test')
    provider.dispose()
  })

  it.each([
    { subscription: false, contentType: 'text/event-stream' },
    { subscription: true, contentType: 'text/event-stream' },
    { subscription: true, contentType: null }
  ])('finishes terminal responses on open connections and retains usage (%j)', async ({ subscription, contentType }) => {
    if (subscription) {
      vi.spyOn(globalThis, 'fetch').mockImplementation(websocketMocks.fetch)
      accountMocks.getCredentials.mockResolvedValue({
        auth_kind: 'chatgpt', auth_flow: 'codex',
        access_token: 'fixture-token', chatgpt_account_id: 'workspace'
      })
    }

    const item = {
      type: 'message', id: 'msg_done', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'Ready 👋', annotations: [] }]
    }
    const response = {
      id: 'resp_done', created_at: 1, model: 'gpt-6.1-sol', status: 'completed',
      output: [item], usage: {
        input_tokens: 100, output_tokens: 10, total_tokens: 110,
        input_tokens_details: { cached_tokens: 80 }
      }
    }
    const events = [
      { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } },
      { type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: 'Ready 👋' },
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response }
    ]
    const bytes = new TextEncoder().encode(events.map((event) =>
      `event: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`
    ).join(''))
    const cancel = vi.fn()
    websocketMocks.fetch.mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller): void {
        // Network chunks can split JSON, UTF-8 characters and SSE delimiters.
        for (let offset = 0; offset < bytes.length; offset += 7) {
          controller.enqueue(bytes.slice(offset, offset + 7))
        }
      },
      cancel
    }), { headers: contentType ? { 'content-type': contentType } : {} }))
    const provider = new OpenAILLMProvider({
      ...TARGET, provider: LLMProviders.OpenAI, model: response.model,
      ...(subscription ? { accountCredentials: {
        auth_kind: 'chatgpt', auth_flow: 'codex', access_token: 'fixture-token',
        chatgpt_account_id: 'workspace', account_id: 'openai.test'
      } } : {})
    })
    const onStreamEvent = vi.fn()

    try {
      const result = normalizeCompletionResultForOpenAICompatibleProvider(
        await provider.runChatCompletion('Report the result.', {
          ...createCompletionParams(null), shouldStream: true, onStreamEvent
        })
      )

      expect(result.rawResult).toBe('Ready 👋')
      expect(result.usedInputTokens).toBe(100)
      expect(result.usedOutputTokens).toBe(10)
      expect(result.accounting?.cachedInputTokens).toBe(80)
      expect(onStreamEvent).toHaveBeenCalledWith({ type: 'finish' })
      await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
    } finally {
      provider.dispose()
    }
  }, 2_000)

  it.each(['complete', 'disconnect'])('requires terminal completion after text-end (ending=%s)', async (ending) => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    websocketMocks.fetch.mockResolvedValueOnce(new Response(new ReadableStream({
      start(streamController): void {
        controller = streamController
      }
    }), { headers: { 'content-type': 'text/event-stream' } }))
    const provider = new OpenAILLMProvider({
      ...TARGET, provider: LLMProviders.OpenAI, model: 'gpt-6.1-sol'
    })
    const item = {
      type: 'message', id: 'msg_pending', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'Provisional.', annotations: [] }]
    }
    const response = {
      id: 'resp_pending', created_at: 1, model: 'gpt-6.1-sol', status: 'completed',
      output: [item], usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 }
    }
    const onStreamEvent = vi.fn()
    let settled = false
    const pending = provider.runChatCompletion('Report.', {
      ...createCompletionParams(null), shouldStream: true, onStreamEvent
    }).finally(() => {
      settled = true
    })
    const send = (event: Record<string, unknown>): void => {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
    }

    try {
      controller.enqueue(new TextEncoder().encode(': keep-alive'))
      await vi.waitFor(() => expect(onStreamEvent).toHaveBeenCalledWith({
        type: 'transport-activity', transport: 'websocket'
      }))
      expect(onStreamEvent).toHaveBeenCalledWith({
        type: 'response-headers', transport: 'websocket'
      })
      expect(onStreamEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'stream-open' })
      )
      controller.enqueue(new TextEncoder().encode('\n\n'))

      send({ type: 'response.created', response: { ...response, status: 'in_progress', output: [] } })
      send({ type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } })
      send({ type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: 'Provisional.' })
      send({ type: 'response.output_item.done', output_index: 0, item })
      await vi.waitFor(() => expect(onStreamEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'text-end' })
      ))
      expect(settled).toBe(false)
      expect(onStreamEvent).not.toHaveBeenCalledWith({ type: 'finish' })

      if (ending === 'complete') {
        send({ type: 'response.completed', response })
        expect((await pending).data.choices[0].message.content).toBe('Provisional.')
      } else {
        controller.close()
        await expect(pending).rejects.toThrow()
        expect(onStreamEvent).not.toHaveBeenCalledWith({ type: 'finish' })
      }
    } finally {
      provider.dispose()
    }
  }, 2_000)

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

  it('refreshes a rejected subscription token once and uses rotated credentials on later requests', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(websocketMocks.fetch)
    accountMocks.getCredentials
      .mockResolvedValueOnce({ auth_kind: 'chatgpt', auth_flow: 'codex', chatgpt_account_id: 'workspace', access_token: 'expired-token' })
      .mockResolvedValueOnce({ auth_kind: 'chatgpt', auth_flow: 'codex', chatgpt_account_id: 'workspace', access_token: 'fresh-token' })
      .mockResolvedValueOnce({ auth_kind: 'chatgpt', auth_flow: 'codex', chatgpt_account_id: 'workspace', access_token: 'rotated-token' })
    websocketMocks.fetch
      .mockResolvedValueOnce(Response.json({}, { status: 401 }))
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
        auth_kind: 'chatgpt', auth_flow: 'codex', chatgpt_account_id: 'workspace',
        access_token: 'expired-token',
        account_id: 'openai.test'
      }
    })

    await provider.runChatCompletion('Hello.', createCompletionParams(null))
    await provider.runChatCompletion('Hello again.', createCompletionParams(null))

    expect(accountMocks.getCredentials).toHaveBeenCalledWith('openai.test', undefined, true)
    expect(websocketMocks.create).not.toHaveBeenCalled()
    expect(websocketMocks.fetch.mock.calls.map(([, request]) =>
      new Headers(request.headers).get('authorization')
    )).toEqual(['Bearer expired-token', 'Bearer fresh-token', 'Bearer rotated-token'])
    expect(websocketMocks.close).not.toHaveBeenCalled()
    expect(accountMocks.markNeedsAttention).not.toHaveBeenCalled()
    provider.dispose()
  })

  it('reports reconnect after a forbidden subscription response without switching accounts', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(websocketMocks.fetch)
    accountMocks.getCredentials.mockResolvedValue({ auth_kind: 'chatgpt', auth_flow: 'codex', chatgpt_account_id: 'workspace', access_token: 'revoked-token' })
    websocketMocks.fetch.mockResolvedValueOnce(Response.json({}, { status: 403 }))
    const provider = new OpenAILLMProvider({
      provider: LLMProviders.OpenAI,
      model: 'gpt-6.1-sol',
      label: 'OpenAI',
      isEnabled: true,
      isLocal: false,
      isResolved: true,
      accountCredentials: {
        auth_kind: 'chatgpt', auth_flow: 'codex', chatgpt_account_id: 'workspace',
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
    vi.mocked(CONFIG_MANAGER.getConfig).mockReturnValue({
      llm: { model_settings: {} }
    } as ReturnType<typeof CONFIG_MANAGER.getConfig>)
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
    'openrouter'
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

  it('streams Z.ai tool arguments into a provisional call before returning its completed decision', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const fetch = vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(streamController): void {
        controller = streamController
      }
    }), { headers: { 'content-type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetch)
    const provider = new ZAILLMProvider({ ...TARGET, provider: LLMProviders.ZAI, model: 'glm-5.3' })
    const calls: OpenAIToolCall[] = []
    const completion = provider.runChatCompletion('Read README.md', {
      ...PARAMS,
      shouldStream: true,
      onToolCall: (call): void => {
        calls.push(call)
      }
    })
    const send = (delta: Record<string, unknown>, finishReason: string | null = null): void => {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
        id: 'response-1', model: 'glm-5.3', created: 1,
        choices: [{ index: 0, delta, finish_reason: finishReason }]
      })}\n\n`))
    }

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    send({ tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'read_file', arguments: '{"path":' } }] })
    await vi.waitFor(() => expect(calls.at(-1)?.function.arguments).toBe('{"path":'))
    expect(JSON.parse(fetch.mock.calls[0]![1].body).tool_stream).toBe(true)
    send({ tool_calls: [{ index: 0, function: { arguments: '"README.md"}' } }] }, 'tool_calls')
    controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
    controller.close()

    const response = await completion
    expect(response.data.choices[0].message.tool_calls[0]).toMatchObject({
      id: 'call-1', function: { name: 'read_file', arguments: '{"path":"README.md"}' }
    })
  })

  it('uses the native DeepSeek SDK for tool turns and Responses for schema-constrained output', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json(CHAT_RESPONSE))
      .mockResolvedValueOnce(Response.json({
        id: 'response-2', object: 'response', created_at: 1, model: 'deepseek-flash', status: 'completed',
        output: [{ type: 'message', id: 'message-1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '{"done":true}', annotations: [] }] }],
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 80 } }
      }))
    vi.stubGlobal('fetch', fetch)
    const provider = new DeepSeekLLMProvider({ ...TARGET, provider: LLMProviders.DeepSeek, model: 'deepseek-flash' })

    const onStreamEvent = vi.fn()
    const response = await provider.runChatCompletion('Read README.md', { ...PARAMS, onStreamEvent })
    expect(fetch.mock.calls[0]![0]).toMatch(/\/chat\/completions$/)
    expect(response.data.choices[0].message.tool_calls[0].function.name).toBe('read_file')
    expect(response.data.usage.prompt_tokens).toBe(100)

    await provider.runChatCompletion('Is it done?', {
      ...PARAMS,
      onStreamEvent,
      toolChoice: 'none',
      data: { done: { type: 'boolean' } }
    })
    expect(fetch.mock.calls[1]![0]).toMatch(/\/responses$/)
    expect(JSON.parse(fetch.mock.calls[1]![1].body).text.format.type).toBe('json_schema')
    expect(onStreamEvent.mock.calls.filter(([event]) => event.type === 'prompt-cache')).toHaveLength(2)
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).not.toHaveProperty('prompt_cache_key')
  })

  it('uses Groq Responses while preserving native seed and hidden-reasoning controls', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({
        id: 'response-1', object: 'response', created_at: 1, model: 'openai/gpt-oss-120b', status: 'completed',
        output: [{ type: 'function_call', id: 'item-1', call_id: 'call-1', name: 'read_file', arguments: '{"path":"README.md"}', status: 'completed' }],
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 80 } }
      }))
      .mockResolvedValueOnce(Response.json(CHAT_RESPONSE))
    vi.stubGlobal('fetch', fetch)
    const provider = new GroqLLMProvider({ ...TARGET, provider: LLMProviders.Groq, model: 'openai/gpt-oss-120b' })

    const response = await provider.runChatCompletion('Read README.md', PARAMS)
    expect(fetch.mock.calls[0]![0]).toMatch(/\/responses$/)
    expect(response.data.usage.accounting.cachedInputTokens).toBe(80)
    expect(response.data.choices[0].message.tool_calls[0].function.name).toBe('read_file')

    await provider.runChatCompletion('Read README.md', { ...PARAMS, seed: 42, reasoningMode: 'off' })
    expect(fetch.mock.calls[1]![0]).toMatch(/\/chat\/completions$/)
    expect(JSON.parse(fetch.mock.calls[1]![1].body)).toMatchObject({ seed: 42, reasoning_format: 'hidden' })
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
