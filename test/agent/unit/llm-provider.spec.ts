import { Readable } from 'node:stream'

import type { AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LogHelper } from '@/helpers/log-helper'

import LLMProvider from '@/core/llm-manager/llm-provider'
import { normalizeStreamingCompletionResult } from '@/core/llm-manager/llm-provider/llm-provider-stream'
import { LLMDuties, LLMProviders, type CompletionParams } from '@/core/llm-manager/types'

const celerisTarget = {
  provider: 'celeris',
  model: 'celeris-1',
  label: 'celeris/celeris-1',
  isLocal: false,
  isEnabled: true,
  isResolved: true
}

vi.mock('@/core/config-states/config-state', () => ({
  CONFIG_STATE: {
    getModelState: vi.fn(() => ({
      getAgentProvider: vi.fn(() => celerisTarget.provider),
      getWorkflowProvider: vi.fn(() => 'celeris'),
      getAgentTarget: vi.fn(() => celerisTarget),
      getWorkflowTarget: vi.fn(() => celerisTarget)
    })),
    getModelSettingsState: vi.fn(() => ({
      getSettings: vi.fn(() => ({
        reasoning: 'auto',
        speed: 'auto'
      }))
    }))
  }
}))

vi.mock('@/core', () => ({
  BRAIN: {
    wernicke: vi.fn((text: string) => text)
  }
}))

vi.mock('@/core/profile-runtime/profile-context', () => ({
  getActiveProfileName: vi.fn(() => 'test')
}))

vi.mock('@/helpers/log-helper', () => ({
  LogHelper: {
    title: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    time: vi.fn(),
    timeEnd: vi.fn()
  }
}))

interface LLMProviderTestState {
  agentLLMProvider: {
    modelName: string
    runChatCompletion: ReturnType<typeof vi.fn>
  }
  agentLLMProviderTargetLabel: string
}

describe('LLMProvider', () => {
  it('preserves owner cancellation across an attempt-level retry', async () => {
    // Exercise the real retry/cancellation path without waiting for its backoff.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const owner = new AbortController()
      const attempt = new AbortController()
      const reason = new Error('Owner canceled')
      const signals: AbortSignal[] = []
      const runChatCompletion = vi.fn((_prompt, params) => {
        signals.push(params.signal)
        queueMicrotask(() => {
          if (signals.length === 1) {
            attempt.abort({ shouldRetry: true, retryStrategy: 'timeout', source: 'agent_tool_call_diagnosis', delayMs: 1 })
          } else owner.abort(reason)
        })
        return new Promise((_resolve, reject) => params.signal.addEventListener('abort', () => reject(params.signal.reason), { once: true }))
      })
      const manager = new LLMProvider()
      const state = manager as unknown as LLMProviderTestState
      state.agentLLMProvider = { modelName: 'celeris-1', runChatCompletion }
      state.agentLLMProviderTargetLabel = celerisTarget.label
      const canceled = expect(manager.prompt('Hello', {
        dutyType: LLMDuties.ReAct, systemPrompt: '', shouldStream: false,
        signal: attempt.signal, cancellationSignal: owner.signal,
        maxRetries: 2, remoteProviderErrorRetries: 2
      })).rejects.toBe(reason)
      await vi.runAllTimersAsync()
      await canceled
      expect(runChatCompletion).toHaveBeenCalledTimes(2)
      expect(signals.every((signal) => signal.aborted)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    { code: 'UND_ERR_CONNECT_TIMEOUT', aggregate: false },
    { code: 'ETIMEDOUT', aggregate: true },
    { code: 'ECONNRESET', aggregate: false }
  ])('bounds $code connection retries without extending inference time', async ({ code, aggregate }) => {
    vi.useFakeTimers()
    vi.mocked(LogHelper.warning).mockClear()
    vi.mocked(LogHelper.error).mockClear()

    try {
      const cause = Object.assign(new Error('Connection failed'), {
        code,
        syscall: 'connect'
      })
      const error = new Error('Cannot connect to API', {
        cause: aggregate ? new AggregateError([cause]) : cause
      })
      const attempts: CompletionParams[] = []
      const runChatCompletion = vi.fn((_prompt, params: CompletionParams) => {
        attempts.push(params)

        return Promise.reject(error)
      })
      const manager = new LLMProvider()
      const state = manager as unknown as LLMProviderTestState

      state.agentLLMProvider = { modelName: 'celeris-1', runChatCompletion }
      state.agentLLMProviderTargetLabel = celerisTarget.label

      const result = manager.prompt('Hello', {
        dutyType: LLMDuties.ReAct,
        systemPrompt: '',
        shouldStream: false,
        timeout: 120_000,
        maxRetries: 2
      })

      await vi.advanceTimersByTimeAsync(0)
      expect(attempts).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(4_999)
      expect(attempts).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(1)
      expect(await result).toBeNull()
      expect(attempts).toHaveLength(2)
      expect(attempts.map((params) => params.timeout)).toEqual([120_000, 120_000])
      expect(LogHelper.warning).toHaveBeenCalledWith(
        expect.stringContaining(`Provider connection failed (${code})`)
      )
      expect(LogHelper.warning).not.toHaveBeenCalledWith(
        expect.stringContaining('Prompt timed out')
      )
      expect(LogHelper.error).toHaveBeenCalledWith(
        expect.stringContaining(`"connectionErrorCode":"${code}"`)
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('still extends the deadline after a genuine inference timeout', async () => {
    vi.useFakeTimers()

    try {
      const attempts: CompletionParams[] = []
      const runChatCompletion = vi.fn((_prompt, params: CompletionParams) => {
        attempts.push(params)

        return new Promise(() => {})
      })
      const manager = new LLMProvider()
      const state = manager as unknown as LLMProviderTestState

      state.agentLLMProvider = { modelName: 'celeris-1', runChatCompletion }
      state.agentLLMProviderTargetLabel = celerisTarget.label

      const result = manager.prompt('Hello', {
        dutyType: LLMDuties.ReAct,
        systemPrompt: '',
        shouldStream: false,
        timeout: 120_000,
        maxRetries: 1,
        remoteProviderErrorRetries: 0
      })

      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(120_000)
      expect(attempts.map((params) => params.timeout)).toEqual([120_000, 150_000])

      await vi.advanceTimersByTimeAsync(150_000)
      expect(await result).toBeNull()
      expect(attempts).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['text', 'tool'] as const)(
    'separates inference from %s stream silence and retries without extending idle time',
    async (output) => {
      vi.useFakeTimers()

      try {
        const attempts: CompletionParams[] = []
        const runChatCompletion = vi.fn((_prompt, params: CompletionParams) => {
          attempts.push(params)
          params.onStreamEvent?.({ type: 'stream-open', transport: 'http', requestId: 'req-test' })

          if (attempts.length === 2) {
            params.onToken?.('Recovered')

            return Promise.resolve({ data: {
              choices: [{ message: { content: 'Recovered' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 10, completion_tokens: 1 }
            } })
          }

          return new Promise((_resolve, reject) => {
            params.signal?.addEventListener('abort', () => {
              reject(params.signal?.reason)
            }, { once: true })
          })
        })
        const manager = new LLMProvider()
        const state = manager as unknown as LLMProviderTestState

        state.agentLLMProvider = { modelName: 'celeris-1', runChatCompletion }
        state.agentLLMProviderTargetLabel = celerisTarget.label

        const pending = manager.prompt('Hello', {
          dutyType: LLMDuties.ReAct,
          systemPrompt: '',
          shouldStream: true,
          timeout: 120_000,
          maxRetries: 1
        })

        await vi.advanceTimersByTimeAsync(0)

        // Opening a connection, or an empty token, is not model output.
        attempts[0]!.onToken?.('')
        await vi.advanceTimersByTimeAsync(40_000)
        expect(attempts[0]!.signal?.aborted).toBe(false)

        const progress = (): void => {
          if (output === 'text') {
            attempts[0]!.onToken?.('partial')
          } else {
            attempts[0]!.onStreamEvent?.({ type: 'tool-input-delta' })
          }
        }

        progress()
        await vi.advanceTimersByTimeAsync(29_000)
        progress()
        await vi.advanceTimersByTimeAsync(29_000)
        expect(attempts).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(1_001)

        const result = await pending

        expect(attempts).toHaveLength(2)
        expect(attempts[0]!.signal?.aborted).toBe(true)
        expect(attempts[1]!.timeout).toBe(120_000)
        expect(result?.firstTokenAt).toBeGreaterThan(0)
        expect(LogHelper.error).toHaveBeenCalledWith(expect.stringContaining('req-test'))
        expect(LogHelper.error).toHaveBeenCalledWith(expect.stringContaining('LLMStreamIdleTimeout'))
      } finally {
        vi.useRealTimers()
      }
    }
  )

  it.each(['reasoning', 'hosted tool'])('allows silent %s and reports actual text arrival', async (phase) => {
    vi.useFakeTimers()

    try {
      let params: CompletionParams | undefined
      let complete: (value: unknown) => void = () => {}
      const runChatCompletion = vi.fn((_prompt, options: CompletionParams) => {
        params = options

        return new Promise((resolve) => {
          complete = resolve
        })
      })
      const manager = new LLMProvider()
      const state = manager as unknown as LLMProviderTestState

      state.agentLLMProvider = { modelName: 'celeris-1', runChatCompletion }
      state.agentLLMProviderTargetLabel = celerisTarget.label

      const pending = manager.prompt('Think', {
        dutyType: LLMDuties.ReAct,
        systemPrompt: '',
        shouldStream: true,
        maxRetries: 0
      })

      await vi.advanceTimersByTimeAsync(0)
      params!.onStreamEvent?.(phase === 'reasoning'
        ? { type: 'reasoning-start' }
        : { type: 'tool-call', toolCallId: 'hosted', providerExecuted: true })
      await vi.advanceTimersByTimeAsync(60_000)
      expect(params!.signal?.aborted).toBe(false)
      params!.onStreamEvent?.(phase === 'reasoning'
        ? { type: 'reasoning-end' }
        : { type: 'tool-result', toolCallId: 'hosted' })

      const firstTokenAt = Date.now()

      params!.onToken?.('Done')
      params!.onStreamEvent?.({ type: 'finish' })
      await vi.advanceTimersByTimeAsync(120_000)
      expect(params!.signal?.aborted).toBe(false)

      complete({ data: {
        choices: [{ message: { content: 'Done' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 1 }
      } })

      expect((await pending)?.firstTokenAt).toBe(firstTokenAt)
    } finally {
      vi.useRealTimers()
    }
  })

  beforeEach(() => {
    vi.clearAllMocks()
    celerisTarget.provider = LLMProviders.Celeris
  })

  it.each([LLMProviders.Celeris, LLMProviders.DeepSeek])('normalizes a %s OpenAI-compatible completion', async (provider) => {
    celerisTarget.provider = provider
    const runChatCompletion = vi.fn().mockResolvedValue({
      data: {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Hello from Celeris.'
            },
            finish_reason: 'stop'
          }
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 5
        }
      }
    })
    const manager = new LLMProvider()
    const state = manager as unknown as LLMProviderTestState

    state.agentLLMProvider = {
      modelName: 'celeris-1',
      runChatCompletion
    }
    state.agentLLMProviderTargetLabel = celerisTarget.label

    const result = await manager.prompt('Hello', {
      dutyType: LLMDuties.ReAct,
      systemPrompt: '',
      data: null,
      shouldStream: false,
      maxRetries: 0,
      remoteProviderErrorRetries: 0
    })

    expect(result).toMatchObject({
      output: 'Hello from Celeris.',
      usedInputTokens: 12,
      usedOutputTokens: 5,
      finishReason: 'stop'
    })
    expect(runChatCompletion.mock.calls[0]![1].maxTokens).toBeUndefined()
    await manager.prompt('Explicit bounded request', {
      dutyType: LLMDuties.ReAct, systemPrompt: '', maxTokens: 128,
      maxRetries: 0, remoteProviderErrorRetries: 0
    })
    expect(runChatCompletion.mock.calls[1]![1].maxTokens).toBe(128)
  })

  it.each([
    {
      name: 'removes the reported empty block',
      content: '<think>\n\n</think>\n\nage_skill',
      expected: 'age_skill'
    },
    {
      name: 'removes consecutive empty blocks and surrounding whitespace',
      content: ' \n<THINK> </THINK>\n<think></think>\nHello',
      expected: 'Hello'
    },
    {
      name: 'preserves indentation without a thinking block',
      content: '    return 42'
    },
    {
      name: 'preserves embedded tags',
      content: 'Example: `<think>reasoning</think>` and `<think></think>`'
    },
    {
      name: 'preserves JSON values',
      content: '{"example":"<think></think>"}',
      data: {}
    },
    {
      name: 'preserves non-empty reasoning blocks',
      content: '<think>reasoning</think>Hello'
    },
    {
      name: 'preserves blocks when thinking is enabled',
      content: '<think></think>Hello',
      disableThinking: false
    },
    {
      name: 'preserves blocks for other providers',
      content: '<think></think>Hello',
      provider: LLMProviders.Celeris
    }
  ])('$name', async ({ content, expected, data, disableThinking, provider }) => {
    celerisTarget.provider = provider ?? LLMProviders.LlamaCPP
    const manager = new LLMProvider()
    const state = manager as unknown as LLMProviderTestState

    state.agentLLMProvider = {
      modelName: 'test-model',
      runChatCompletion: vi.fn().mockResolvedValue({
        data: {
          choices: [{ message: { role: 'assistant', content } }],
          usage: { prompt_tokens: 12, completion_tokens: 5 }
        }
      })
    }
    state.agentLLMProviderTargetLabel = celerisTarget.label

    const result = await manager.prompt('Hello', {
      dutyType: LLMDuties.ReAct,
      systemPrompt: '',
      data: data ?? null,
      disableThinking: disableThinking ?? true,
      shouldStream: false,
      maxRetries: 0,
      remoteProviderErrorRetries: 0
    })

    expect(result?.output).toEqual(
      data ? JSON.parse(content) : (expected ?? content)
    )
  })
})


describe('provider stream normalization', () => {
  it('recovers completed Responses API output across split SSE chunks', async () => {
    const event = {
      type: 'response.completed',
      response: {
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'Checking the weather.' }]
          },
          {
            type: 'function_call',
            call_id: 'call-weather',
            name: 'getWeather',
            arguments: '{"city":"Shanghai"}'
          }
        ],
        usage: { input_tokens: 24, output_tokens: 9 }
      }
    }
    const wire = `data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`
    const response = {
      data: Readable.from([wire.slice(0, 37), wire.slice(37)])
    } as AxiosResponse

    const result = await normalizeStreamingCompletionResult(
      response,
      { dutyType: LLMDuties.ReAct, systemPrompt: '' },
      LLMProviders.OpenAI
    )

    expect(result).toMatchObject({
      rawResult: 'Checking the weather.',
      usedInputTokens: 24,
      usedOutputTokens: 9,
      toolCalls: [{
        id: 'call-weather',
        type: 'function',
        function: { name: 'getWeather', arguments: '{"city":"Shanghai"}' }
      }]
    })
  })

  it('preserves compatible reasoning, text deltas, and trailing usage', async () => {
    const onToken = vi.fn()
    const onReasoningToken = vi.fn()
    const events = [
      { choices: [{ delta: { reasoning_content: 'Check the conditions.' } }] },
      { choices: [{ delta: { content: 'Hello ' } }] },
      { choices: [{ delta: { content: 'world' }, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 12, completion_tokens: 5 } }
    ]
    const wire = events.map((event) => `data: ${JSON.stringify(event)}`).join('\n\n')
    const response = { data: Readable.from([wire]) } as AxiosResponse

    const result = await normalizeStreamingCompletionResult(
      response,
      { dutyType: LLMDuties.ReAct, systemPrompt: '', onToken, onReasoningToken },
      LLMProviders.Celeris
    )

    expect(result).toMatchObject({
      rawResult: 'Hello world',
      reasoning: 'Check the conditions.',
      usedInputTokens: 12,
      usedOutputTokens: 5,
      finishReason: 'stop'
    })
    expect(onToken.mock.calls.map(([chunk]) => chunk).join('')).toBe('Hello world')
    expect(onReasoningToken).toHaveBeenCalledWith('Check the conditions.')
  })
})
