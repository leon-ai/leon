import { Readable } from 'node:stream'

import type { AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LogHelper } from '@/helpers/log-helper'
import { FileHelper } from '@/helpers/file-helper'
import { getModelAccountCredentials } from '@/core/llm-manager/llm-accounts'

import LLMProvider from '@/core/llm-manager/llm-provider'
import LlamaCPPLLMProvider from '@/core/llm-manager/llm-providers/llamacpp-llm-provider'
import { normalizeStreamingCompletionResult } from '@/core/llm-manager/llm-provider/llm-provider-stream'
import { LLMDuties, LLMProviders, type CompletionParams } from '@/core/llm-manager/types'
import { appendInferenceUsage } from '@/core/llm-manager/llm-usage/usage-ledger'

vi.mock('@/core/llm-manager/llm-usage/usage-ledger', () => ({
  appendInferenceUsage: vi.fn().mockResolvedValue(undefined)
}))

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
    })),
    getRoutingModeState: vi.fn(() => ({ getRoutingMode: (): string => 'agent' }))
  }
}))

vi.mock('@/core/llm-manager/llm-accounts', () => ({
  getModelAccountCredentials: vi.fn()
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
  it('releases cancellation after bounded cleanup when the provider ignores abort', async () => {
    vi.useFakeTimers()

    try {
      const controller = new AbortController()
      const onToken = vi.fn()
      const onToolCall = vi.fn()
      let params!: CompletionParams
      const runChatCompletion = vi.fn((_prompt, input: CompletionParams) => {
        params = input
        return new Promise(() => {})
      })
      const manager = new LLMProvider()
      const state = manager as unknown as LLMProviderTestState
      state.agentLLMProvider = { modelName: 'celeris-1', runChatCompletion }
      state.agentLLMProviderTargetLabel = celerisTarget.label
      const pending = manager.prompt('Choose an action', {
        dutyType: LLMDuties.ReAct,
        systemPrompt: '',
        cancellationSignal: controller.signal,
        onToken,
        onToolCall
      }).then(() => null, (error) => error)

      await vi.advanceTimersByTimeAsync(0)
      const reason = new Error('Owner canceled')
      controller.abort(reason)
      await vi.advanceTimersByTimeAsync(1_000)

      expect(await pending).toBe(reason)
      params.onToken?.('Late output')
      params.onToolCall?.({
        id: 'late-call',
        type: 'function',
        function: { name: 'read_file', arguments: '{}' }
      })
      expect(onToken).not.toHaveBeenCalled()
      expect(onToolCall).not.toHaveBeenCalled()
      expect(runChatCompletion).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits for canceled provider cleanup before releasing the caller', async () => {
    const controller = new AbortController()
    let finish!: () => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const runChatCompletion = vi.fn(async (_prompt, params) => {
      entered()
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      expect(params.signal.aborted).toBe(true)
      throw controller.signal.reason
    })
    const manager = new LLMProvider()
    const state = manager as unknown as LLMProviderTestState
    state.agentLLMProvider = { modelName: 'celeris-1', runChatCompletion }
    state.agentLLMProviderTargetLabel = celerisTarget.label
    let settled = false
    const pending = manager
      .prompt('Choose an action', {
        dutyType: LLMDuties.ReAct,
        systemPrompt: '',
        shouldStream: false,
        cancellationSignal: controller.signal
      })
      .catch((error) => {
        settled = true
        return error
      })

    await started
    const reason = new Error('Owner canceled')
    controller.abort(reason)
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toBe(false)
    finish()
    expect(await pending).toBe(reason)
    expect(runChatCompletion).toHaveBeenCalledOnce()
  })

  it('keeps request cancellation active while consuming a returned stream', async () => {
    vi.useFakeTimers()
    const stream = new Readable({ read(): void {} })
    try {
      const controller = new AbortController()
      const onToken = vi.fn()
      const runChatCompletion = vi.fn().mockResolvedValue({ data: stream })
      const manager = new LLMProvider()
      const state = manager as unknown as LLMProviderTestState
      state.agentLLMProvider = { modelName: 'celeris-1', runChatCompletion }
      state.agentLLMProviderTargetLabel = celerisTarget.label
      const pending = manager.prompt('Hello', {
        dutyType: LLMDuties.ReAct, systemPrompt: '', shouldStream: true,
        cancellationSignal: controller.signal, onToken
      }).then(() => null, (error) => error)
      stream.push('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n')
      await vi.advanceTimersByTimeAsync(0)
      expect(onToken).toHaveBeenCalledWith('Partial')
      const reason = new Error('Model response deadline exceeded')
      controller.abort(reason)
      expect(await pending).toBe(reason)
      expect(runChatCompletion).toHaveBeenCalledOnce()
      stream.push('data: {"choices":[{"delta":{"content":"Late"}}]}\n\n')
      await vi.advanceTimersByTimeAsync(0)
      expect(onToken).toHaveBeenCalledOnce()
    } finally {
      stream.destroy()
      vi.useRealTimers()
    }
  })

  it.each([1, 2])('keeps initialization recoverable when account lookup %s fails', async (failedLookup) => {
    const dispose = vi.fn()
    class ReadyProvider {
      public modelName = 'celeris-1'
      public dispose = dispose
    }
    const credentials = vi.mocked(getModelAccountCredentials)
    credentials.mockResolvedValue(null)
    if (failedLookup === 2) {
      credentials.mockResolvedValueOnce(null)
    }
    const message = 'Reconnect this account with /connection ai connect openai.saved.'
    credentials.mockRejectedValueOnce(new Error(message))
    vi.spyOn(FileHelper, 'dynamicImportFromFile').mockResolvedValue({ default: ReadyProvider })
    const manager = new LLMProvider()

    await expect(manager.init()).resolves.toBe(false)
    expect(manager.isLLMProviderReady).toBe(false)
    expect(manager.consumeLastProviderErrorMessage()).toBe(message)
    expect(dispose).toHaveBeenCalledTimes(failedLookup - 1)

    // Reconnecting can reload the existing runtime without restarting the process.
    await expect(manager.init()).resolves.toBe(true)
    expect(manager.isLLMProviderReady).toBe(true)
    expect(manager.consumeLastProviderErrorMessage()).toBeNull()
    manager.dispose()
  })

  it('preserves cache accounting and total input tokens on direct llama.cpp streams', async () => {
    // Exercise the direct parser without starting a model server.
    const provider = Object.create(LlamaCPPLLMProvider.prototype) as {
      consumeStreamingResponse(
        stream: Readable,
        params: CompletionParams
      ): Promise<Record<string, unknown>>
    }
    const onToken = vi.fn()
    const chunks = [
      { choices: [{ delta: { content: 'Hello' } }] },
      {
        choices: [],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 2,
          prompt_tokens_details: { cached_tokens: 80 }
        },
        timings: { cache_n: 80, prompt_n: 20, predicted_n: 2 }
      }
    ]
    const stream = Readable.from(chunks.map((chunk) =>
      `data: ${JSON.stringify(chunk)}\n\n`))
    const result = await provider.consumeStreamingResponse(stream, {
      dutyType: LLMDuties.ReAct,
      systemPrompt: '',
      data: null,
      onToken
    })

    expect(onToken).toHaveBeenCalledWith('Hello')
    expect(result['usage']).toEqual({
      prompt_tokens: 100,
      completion_tokens: 2,
      accounting: { cachedInputTokens: 80 }
    })
  })

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
        if (params.signal.aborted) {
          return Promise.reject(params.signal.reason)
        }
        queueMicrotask(() => {
          if (signals.length === 1) {
            attempt.abort({ shouldRetry: true, retryStrategy: 'timeout', source: 'agent_tool_call_diagnosis', delayMs: 1 })
          } else {
            owner.abort(reason)
          }
        })
        return new Promise((_resolve, reject) => {
          params.signal.addEventListener('abort', () => {
            // Provider cleanup settles after the caller receives cancellation.
            queueMicrotask(() => reject(params.signal.reason))
          }, { once: true })
        })
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
      expect(vi.mocked(appendInferenceUsage).mock.calls).toHaveLength(2)
      expect(vi.mocked(appendInferenceUsage).mock.calls.every(([, record]) =>
        record.outcome !== 'completed' && Object.keys(record.usage).length === 0
      )).toBe(true)
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
        const onAttempt = vi.fn()
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
          maxRetries: 1,
          onAttempt
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
        attempts[0]!.onStreamEvent?.({ type: 'transport-activity' })
        await vi.advanceTimersByTimeAsync(1_001)

        const result = await pending

        expect(attempts).toHaveLength(2)
        expect(attempts[0]!.signal?.aborted).toBe(true)
        expect(attempts[1]!.timeout).toBe(120_000)
        expect(result?.firstTokenAt).toBeGreaterThan(0)
        expect(LogHelper.error).toHaveBeenCalledWith(expect.stringContaining('req-test'))
        expect(LogHelper.error).toHaveBeenCalledWith(expect.stringContaining('LLMStreamIdleTimeout'))
        const timings = onAttempt.mock.calls.map(([timing]) => timing)

        expect(timings.map((timing) => timing.outcome)).toEqual([
          'started', 'LLMStreamIdleTimeout', 'started', 'completed'
        ])
        expect(timings[1]).toMatchObject({
          attemptId: timings[0].attemptId,
          streamOpenMs: 0,
          generationStartMs: 40_000,
          transportIdleMs: 1_000,
          outputIdleMs: 30_000,
          ...(output === 'tool' ? { firstToolInputMs: 40_000 } : { firstTokenMs: 40_000 })
        })
        expect(timings[3].attemptId).not.toBe(timings[0].attemptId)
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

  it('retains reported stream usage when the response ends unsuccessfully', async () => {
    const stream = Readable.from((async function* (): AsyncGenerator<string> {
      yield 'data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":20}}\n\n'
      throw new Error('Provider stream disconnected')
    })())
    const manager = new LLMProvider()
    const state = manager as unknown as LLMProviderTestState

    state.agentLLMProvider = {
      modelName: 'celeris-1',
      runChatCompletion: vi.fn().mockResolvedValue({ data: stream })
    }
    state.agentLLMProviderTargetLabel = celerisTarget.label

    await expect(manager.prompt('Hello', {
      dutyType: LLMDuties.ReAct,
      systemPrompt: '',
      shouldStream: true,
      maxRetries: 0,
      remoteProviderErrorRetries: 0
    })).resolves.toBeNull()
    expect(appendInferenceUsage).toHaveBeenCalledOnce()
    expect(appendInferenceUsage).toHaveBeenCalledWith('test', expect.objectContaining({
      outcome: 'failed',
      usage: { inputTokens: 100, outputTokens: 20 }
    }))
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
    expect(appendInferenceUsage).toHaveBeenLastCalledWith('test', expect.objectContaining({
      provider,
      model: 'celeris-1',
      purpose: LLMDuties.ReAct,
      outcome: 'completed',
      usage: { inputTokens: 12, outputTokens: 5 }
    }))
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
