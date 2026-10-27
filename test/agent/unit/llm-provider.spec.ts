import { Readable } from 'node:stream'

import type { AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LogHelper } from '@/helpers/log-helper'
import { FileHelper } from '@/helpers/file-helper'
import { getModelAccountCredentials } from '@/core/llm-manager/llm-accounts'

import LLMProvider from '@/core/llm-manager/llm-provider'
import LlamaCPPLLMProvider from '@/core/llm-manager/llm-providers/llamacpp-llm-provider'
import { normalizeStreamingCompletionResult } from '@/core/llm-manager/llm-provider/llm-provider-stream'
import { attachProviderFailureDiagnostics, formatPromptErrorForLog } from '@/core/llm-manager/llm-provider/llm-provider-errors'
import { ProviderRequestActivity } from '@/core/llm-manager/llm-provider/provider-request-activity'
import { CompletionFailureKind, LLMDuties, LLMProviders, type CompletionParams } from '@/core/llm-manager/types'
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
    transport?: 'http' | 'websocket'
    runChatCompletion: ReturnType<typeof vi.fn>
  }
  agentLLMProviderTargetLabel: string
}

describe('LLMProvider', () => {
  it('keeps provider progress separate from transport activity and retains bounded failure evidence', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(1_000)
      const activity = new ProviderRequestActivity()
      activity.observe({ type: 'request-uploaded', requestBytes: 42, uploadDurationMs: 10 })
      activity.observe({ type: 'transport-activity' })
      expect(activity.snapshot().providerEventCount).toBe(0)
      expect(activity.snapshot().requestAcceptedMs).toBeUndefined()
      vi.setSystemTime(4_000)
      activity.observe({ type: 'provider-event', providerEventType: 'request.accepted', responseId: 'response-1', requestAccepted: true })
      vi.setSystemTime(6_000)
      activity.observe(Object.assign({ type: 'provider-event', providerEventType: 'tool.running' }, {
        prompt: 'private prompt', image: 'private image data', authorization: 'private credentials'
      }))
      vi.setSystemTime(9_000)
      activity.observe({ type: 'transport-activity' })
      const error = Object.assign(new Error('Connection ended'), { closeCode: 1_006, pongCount: 7 })
      attachProviderFailureDiagnostics(error, activity.snapshot())

      expect(error).toMatchObject({
        responseId: 'response-1', requestAcceptedMs: 3_000,
        firstProviderEventMs: 3_000, lastProviderEventMs: 5_000,
        lastProviderEvent: 'tool.running', providerIdleMs: 3_000,
        providerEventCount: 2, providerCompleted: false, pongCount: 7,
        failureSummary: expect.stringContaining('accepted the request')
      })
      const details = formatPromptErrorForLog(error)
      expect(details).not.toContain('private')
      expect(details).not.toContain('local network instability')
    } finally {
      vi.useRealTimers()
    }
  })

  it('distinguishes completed provider work from delivery failures and preserves cancellation reasons', () => {
    const activity = new ProviderRequestActivity()
    activity.observe({ type: 'finish', requestAccepted: true, providerCompleted: true })
    const failed = new Error('Delivery failed')
    attachProviderFailureDiagnostics(failed, activity.snapshot())
    expect(failed).toMatchObject({ failureSummary: expect.stringContaining('reported completion') })
    const cancelled = new Error('Owner canceled')
    attachProviderFailureDiagnostics(cancelled, activity.snapshot(), true)
    expect(cancelled).not.toHaveProperty('failureSummary')
  })

  

  

  

  it.each([false, true])('logs nested stream diagnostics without request metadata (aggregate=%s)', (aggregate) => {
    const cause = Object.assign(new Error('The provider socket closed.'), {
      closeCode: 1_011,
      closeReason: 'Upstream failure',
      code: 'upstream_error',
      statusCode: 502
    })
    const error = Object.assign(new Error('Failed to process successful response', {
      cause: aggregate ? new AggregateError([cause], 'Stream failed') : cause
    }), {
      statusCode: 200,
      requestBodyValues: { input: 'private prompt' },
      responseHeaders: { authorization: 'private credential' }
    })
    const output = formatPromptErrorForLog(error)

    expect(output).toContain('Failed to process successful response')
    expect(output).toContain('The provider socket closed.')
    expect(output).toContain('"closeCode":1011')
    expect(output).toContain('"closeReason":"Upstream failure"')
    expect(output).toContain('"code":"upstream_error"')
    expect(output).toContain('"statusCode":502')
    expect(output).not.toContain('private prompt')
    expect(output).not.toContain('private credential')
  })

  it('bounds and redacts diagnostics with circular causes', () => {
    const error = Object.assign(new Error('Authorization: Bearer private-credential'), {
      cause: {} as unknown
    })
    error.cause = error
    const output = formatPromptErrorForLog(error)

    expect(output).not.toContain('private-credential')
    expect(output).toContain('[truncated]')
    expect(formatPromptErrorForLog(new Error('x'.repeat(8_000))).length)
      .toBeLessThan(4_100)
  })

  it.each(['http', 'websocket'] as const)(
    'reports the selected %s transport before a connection opens',
    async (transport) => {
      const onAttempt = vi.fn()
      const manager = new LLMProvider()
      const state = manager as unknown as LLMProviderTestState

      state.agentLLMProvider = {
        modelName: 'test-model',
        transport,
        runChatCompletion: vi.fn().mockRejectedValue(new Error('Connection failed'))
      }
      celerisTarget.provider = LLMProviders.OpenAI
      state.agentLLMProviderTargetLabel = celerisTarget.label

      await manager.prompt('Continue.', {
        dutyType: LLMDuties.ReAct,
        shouldStream: true,
        maxRetries: 0,
        remoteProviderErrorRetries: 0,
        onAttempt
      })

      expect(onAttempt.mock.calls.map(([timing]) => timing.transport)).toEqual([
        transport,
        transport
      ])
      expect(onAttempt.mock.calls.at(-1)?.[0]).toMatchObject({
        outcome: 'Error',
        requestDispatchMs: undefined,
        responseHeadersMs: undefined,
        firstByteMs: undefined
      })
    }
  )

  it.each([
    { metadata: { statusCode: 503 }, kind: CompletionFailureKind.Unavailable },
    { metadata: { response: { status: 429 } }, kind: CompletionFailureKind.Unavailable },
    { metadata: { statusCode: 400, data: { error: { code: 'context_length_exceeded' } } }, kind: CompletionFailureKind.Context },
    { metadata: { statusCode: 400, data: { error: { param: 'context_management' } } }, kind: CompletionFailureKind.Context },
    { metadata: { statusCode: 401 }, kind: CompletionFailureKind.Provider }
  ])('preserves structured $kind failures through provider wrappers', async ({ metadata, kind }) => {
    const onAttempt = vi.fn()
    const manager = new LLMProvider()
    const state = manager as unknown as LLMProviderTestState
    state.agentLLMProvider = {
      modelName: 'celeris-1',
      runChatCompletion: vi.fn().mockRejectedValue(new Error('Request failed', {
        cause: metadata
      }))
    }
    state.agentLLMProviderTargetLabel = celerisTarget.label

    const result = await manager.prompt('Continue the task.', {
      dutyType: LLMDuties.ReAct,
      maxRetries: 0,
      remoteProviderErrorRetries: 0,
      onAttempt
    })

    expect(result).toBeNull()
    expect(onAttempt.mock.calls.at(-1)?.[0]).toMatchObject({ failureKind: kind })
    expect(state.agentLLMProvider.runChatCompletion).toHaveBeenCalledOnce()
  })

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
    { code: 'ECONNRESET', aggregate: false },
    { code: 'WEBSOCKET_ABNORMAL_CLOSURE', aggregate: false },
    { code: 'PROVIDER_CONNECTION_UNRESPONSIVE', aggregate: false }
  ])('bounds $code connection retries without extending inference time', async ({ code, aggregate }) => {
    vi.useFakeTimers()
    vi.mocked(LogHelper.warning).mockClear()
    vi.mocked(LogHelper.error).mockClear()

    try {
      const cause = Object.assign(new Error('Connection failed'), {
        code,
        syscall: 'connect',
        ...(code === 'WEBSOCKET_ABNORMAL_CLOSURE' ? { closeCode: 1_006 } : {}),
        ...(code === 'PROVIDER_CONNECTION_UNRESPONSIVE'
          ? { providerEventCount: 0, pingCount: 2, pongCount: 0 }
          : {})
      })
      const error = new Error('Cannot connect to API', {
        cause: aggregate ? new AggregateError([cause]) : cause
      })
      const attempts: CompletionParams[] = []
      const onConnectionRetry = vi.fn()
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
        maxRetries: 2,
        onConnectionRetry
      })

      await vi.advanceTimersByTimeAsync(0)
      expect(attempts).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(4_999)
      expect(attempts).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(1)
      expect(attempts).toHaveLength(2)
      for (const delayMs of [10_000, 15_000, 20_000, 25_000]) {
        await vi.advanceTimersByTimeAsync(delayMs)
      }
      expect(await result).toBeNull()
      expect(attempts).toHaveLength(6)
      expect(attempts.map((params) => params.timeout)).toEqual(Array(6).fill(120_000))
      expect(onConnectionRetry.mock.calls.map(([notice]) => notice)).toEqual(
        [5_000, 10_000, 15_000, 20_000, 25_000].map((delayMs, index) => ({
          attempt: index + 1, maxRetries: 5, delayMs
        }))
      )
      expect(vi.mocked(appendInferenceUsage).mock.calls).toHaveLength(6)
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

  it.each([{ statusCode: 413 }, { closeCode: 1_009 }])('does not retry unchanged input after a nested size rejection: %j', async (details) => {
    const onAttempt = vi.fn()
    const error = Object.assign(new Error('Failed to process successful response'), {
      statusCode: 200,
      cause: Object.assign(new Error('Request is too large'), details)
    })
    const runChatCompletion = vi.fn().mockRejectedValue(error)
    const manager = new LLMProvider()
    const state = manager as unknown as LLMProviderTestState
    state.agentLLMProvider = { modelName: 'celeris-1', runChatCompletion }
    state.agentLLMProviderTargetLabel = celerisTarget.label

    expect(await manager.prompt('Inspect images.', {
      dutyType: LLMDuties.ReAct, systemPrompt: '', shouldStream: false,
      timeout: 120_000, maxRetries: 2, remoteProviderErrorRetries: 2, onAttempt
    })).toBeNull()
    expect(runChatCompletion).toHaveBeenCalledOnce()
    expect(onAttempt.mock.calls.at(-1)?.[0]).toMatchObject({
      failureKind: CompletionFailureKind.Context,
      retryReason: 'unchanged_payload_too_large',
      failureSummary: 'The request exceeded the provider transport size limit.'
    })
  })

  it('resumes the original request when the connection recovers before retry exhaustion', async () => {
    vi.useFakeTimers()
    try {
      const manager = new LLMProvider()
      const state = manager as unknown as LLMProviderTestState
      const onConnectionRetry = vi.fn()
      const runChatCompletion = vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error('Disconnected'), { code: 'ECONNRESET' }))
        .mockRejectedValueOnce(Object.assign(new Error('Disconnected'), { closeCode: 1_006 }))
        .mockResolvedValue({ data: {
          choices: [{ message: { content: 'Recovered' } }],
          usage: { prompt_tokens: 10, completion_tokens: 1 }
        } })
      state.agentLLMProvider = { modelName: 'celeris-1', runChatCompletion }
      state.agentLLMProviderTargetLabel = celerisTarget.label
      const pending = manager.prompt('Resume the original task.', {
        dutyType: LLMDuties.ReAct, systemPrompt: '', onConnectionRetry
      })

      await vi.runAllTimersAsync()
      expect((await pending)?.output).toBe('Recovered')
      expect(runChatCompletion).toHaveBeenCalledTimes(3)
      expect(runChatCompletion.mock.calls.every(([prompt]) => prompt === 'Resume the original task.')).toBe(true)
      expect(onConnectionRetry).toHaveBeenCalledTimes(2)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['accepted', 'output', 'deadline'])('does not reconnect when blocked by %s evidence', async (blocker) => {
    const manager = new LLMProvider()
    const state = manager as unknown as LLMProviderTestState
    const onConnectionRetry = vi.fn()
    const runChatCompletion = vi.fn((_prompt, params: CompletionParams) => {
      if (blocker === 'accepted') {
        params.onStreamEvent?.({ type: 'provider-event', requestAccepted: true })
      } else if (blocker === 'output') {
        params.onToken?.('Partial output')
      }
      return Promise.reject(Object.assign(new Error('Connection failed'), { code: 'ECONNRESET' }))
    })
    state.agentLLMProvider = { modelName: 'celeris-1', runChatCompletion }
    state.agentLLMProviderTargetLabel = celerisTarget.label

    expect(await manager.prompt('Continue.', {
      dutyType: LLMDuties.ReAct, systemPrompt: '', shouldStream: true, onConnectionRetry,
      ...(blocker === 'deadline' ? { getRetryTimeout: (timeout: number): number => Math.min(timeout, 4_000) } : {})
    })).toBeNull()
    expect(runChatCompletion).toHaveBeenCalledOnce()
    expect(onConnectionRetry).not.toHaveBeenCalled()
  })

  it('cancels a reconnect wait immediately with the owner cancellation reason', async () => {
    vi.useFakeTimers()
    try {
      const owner = new AbortController()
      const reason = new Error('Owner canceled')
      const manager = new LLMProvider()
      const state = manager as unknown as LLMProviderTestState
      const runChatCompletion = vi.fn().mockRejectedValue(
        Object.assign(new Error('Connection failed'), { code: 'ECONNRESET' })
      )
      state.agentLLMProvider = { modelName: 'celeris-1', runChatCompletion }
      state.agentLLMProviderTargetLabel = celerisTarget.label
      const onConnectionRetry = vi.fn((): void => {
        setTimeout(() => owner.abort(reason), 100)
      })
      const pending = expect(manager.prompt('Continue.', {
        dutyType: LLMDuties.ReAct, systemPrompt: '', cancellationSignal: owner.signal, onConnectionRetry
      })).rejects.toBe(reason)

      await vi.advanceTimersByTimeAsync(100)
      await pending
      expect(runChatCompletion).toHaveBeenCalledOnce()
      expect(onConnectionRetry).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('honors disabled connection recovery after consuming the transient retry', async () => {
    vi.useFakeTimers()

    try {
      const attempts: CompletionParams[] = []
      const onAttempt = vi.fn()
      const runChatCompletion = vi.fn((_prompt, params: CompletionParams) => {
        attempts.push(params)
        if (attempts.length === 1) {
          return new Promise(() => {})
        }

        throw Object.assign(new Error('Connection failed'), { code: 'ECONNRESET' })
      })
      const manager = new LLMProvider()
      const state = manager as unknown as LLMProviderTestState
      state.agentLLMProvider = { modelName: 'celeris-1', runChatCompletion }
      state.agentLLMProviderTargetLabel = celerisTarget.label

      const pending = manager.prompt('Continue.', {
        dutyType: LLMDuties.ReAct, systemPrompt: '', timeout: 1_000,
        maxRetries: 2, remoteProviderErrorRetries: 2, connectionErrorRetries: 0, onAttempt
      })

      await vi.advanceTimersByTimeAsync(1_000)
      expect(await pending).toBeNull()
      expect(attempts).toHaveLength(2)
      expect(attempts.map((params) => params.timeout)).toEqual([1_000, 1_000])
      expect(onAttempt.mock.calls[1]?.[0]).toMatchObject({
        retryDecision: 'retry', retryReason: 'quick_transient_failure'
      })
      expect(onAttempt.mock.calls.at(-1)?.[0]).toMatchObject({
        retryDecision: 'stop', retryReason: 'retry_budget_exhausted'
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    { message: 'tool_choice is incompatible with thinking', disableThinking: false, keepsChoice: true },
    { message: 'tool_choice is incompatible with thinking', disableThinking: true, keepsChoice: false },
    { message: 'unsupported value for tool_choice', disableThinking: false, keepsChoice: false }
  ])('preserves provider compatibility recovery without consuming transient retries: $message ($disableThinking)', async ({ message, disableThinking, keepsChoice }) => {
    const runChatCompletion = vi.fn()
      .mockRejectedValueOnce(new Error(message))
      .mockResolvedValue({ data: {
        choices: [{ message: { content: 'Recovered' } }],
        usage: { prompt_tokens: 10, completion_tokens: 1 }
      } })
    const manager = new LLMProvider()
    const state = manager as unknown as LLMProviderTestState
    state.agentLLMProvider = { modelName: 'celeris-1', runChatCompletion }
    state.agentLLMProviderTargetLabel = celerisTarget.label

    const result = await manager.prompt('Continue.', {
      dutyType: LLMDuties.ReAct, systemPrompt: '', disableThinking,
      tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }],
      toolChoice: 'required', maxRetries: 1, remoteProviderErrorRetries: 0
    })

    expect(result?.output).toBe('Recovered')
    expect(runChatCompletion).toHaveBeenCalledTimes(2)
    expect(runChatCompletion.mock.calls[1]?.[1]).toMatchObject({
      maxRetries: 0, remoteProviderErrorRetries: 0,
      ...(keepsChoice ? { disableThinking: true, toolChoice: 'required' } : { relaxForcedToolChoice: true })
    })
    if (!keepsChoice) {
      expect(runChatCompletion.mock.calls[1]?.[1].toolChoice).toBeUndefined()
    }
  })

  it.each([401, 403, 422])('does not retry permanent provider rejection %s', async (statusCode) => {
    const manager = new LLMProvider()
    const state = manager as unknown as LLMProviderTestState
    const runChatCompletion = vi.fn().mockRejectedValue(
      Object.assign(new Error('Provider rejected request'), { statusCode })
    )
    state.agentLLMProvider = { modelName: 'celeris-1', runChatCompletion }
    state.agentLLMProviderTargetLabel = celerisTarget.label

    expect(await manager.prompt('Continue.', {
      dutyType: LLMDuties.ReAct, systemPrompt: ''
    })).toBeNull()
    expect(runChatCompletion).toHaveBeenCalledOnce()
  })

  it.each([0, 20_000])('preserves the caller finishing reserve when the retry budget is %sms', async (retryBudget) => {
    vi.useFakeTimers()

    try {
      const attempts: CompletionParams[] = []
      const manager = new LLMProvider()
      const state = manager as unknown as LLMProviderTestState

      state.agentLLMProvider = {
        modelName: 'celeris-1',
        runChatCompletion: vi.fn((_prompt, params: CompletionParams) => {
          attempts.push(params)
          return new Promise(() => {})
        })
      }
      state.agentLLMProviderTargetLabel = celerisTarget.label

      const retryDeadline = Date.now() + 10_000 + retryBudget
      const result = manager.prompt('Finish the deliverable.', {
        dutyType: LLMDuties.ReAct,
        systemPrompt: '',
        shouldStream: false,
        timeout: 10_000,
        maxRetries: 2,
        remoteProviderErrorRetries: 1,
        getRetryTimeout: (timeout) => Math.min(timeout, Math.max(0, retryDeadline - Date.now()))
      })

      await vi.advanceTimersByTimeAsync(10_000)
      if (retryBudget > 0) {
        expect(attempts[1]?.timeout).toBe(Math.min(10_000, retryBudget))
        await vi.advanceTimersByTimeAsync(Math.min(10_000, retryBudget))
      }

      expect(await result).toBeNull()
      expect(attempts).toHaveLength(retryBudget > 0 ? 2 : 1)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([false, true])('bounds the initial inference/upload wait without replaying a long timeout (%s)', async (uploading) => {
    vi.useFakeTimers()

    try {
      const attempts: CompletionParams[] = []
      const runChatCompletion = vi.fn((_prompt, params: CompletionParams) => {
        attempts.push(params)
        if (uploading) {
          params.onStreamEvent?.({ type: 'request-dispatched', transport: 'websocket' })
          params.onStreamEvent?.({ type: 'request-upload-start', transport: 'websocket' })
        }

        return new Promise(() => {})
      })
      const manager = new LLMProvider()
      const state = manager as unknown as LLMProviderTestState

      state.agentLLMProvider = { modelName: 'celeris-1', runChatCompletion }
      state.agentLLMProviderTargetLabel = celerisTarget.label

      const result = manager.prompt('Hello', {
        dutyType: LLMDuties.ReAct,
        systemPrompt: '',
        shouldStream: uploading,
        timeout: 120_000,
        maxRetries: 2,
        remoteProviderErrorRetries: 1
      })

      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(120_000)
      expect(await result).toBeNull()
      expect(attempts.map((params) => params.timeout)).toEqual([120_000])
      expect(LogHelper.error).toHaveBeenCalledWith(
        expect.stringContaining('failure_exceeded_retry_window')
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([false, true])('starts the acceptance wait after upload and preserves earlier acceptance (%s)', async (acceptedDuringUpload) => {
    vi.useFakeTimers()

    try {
      let params!: CompletionParams
      let complete!: (value: unknown) => void
      const manager = new LLMProvider()
      const state = manager as unknown as LLMProviderTestState
      state.agentLLMProvider = {
        modelName: 'celeris-1', transport: 'websocket',
        runChatCompletion: vi.fn((_prompt, options: CompletionParams) => {
          params = options
          params.onStreamEvent?.({ type: 'request-dispatched', transport: 'websocket' })
          return new Promise((resolve) => {
            complete = resolve
          })
        })
      }
      state.agentLLMProviderTargetLabel = celerisTarget.label
      const pending = manager.prompt('Inspect the supplied evidence.', {
        dutyType: LLMDuties.ReAct, shouldStream: true, timeout: 120_000,
        maxRetries: 0, remoteProviderErrorRetries: 0
      })

      await vi.advanceTimersByTimeAsync(8_000)
      params.onStreamEvent?.({ type: 'request-upload-start', transport: 'websocket', requestBytes: 4_000_000 })
      if (acceptedDuringUpload) {
        params.onStreamEvent?.({ type: 'provider-event', providerEventType: 'accepted', requestAccepted: true })
      }
      await vi.advanceTimersByTimeAsync(20_000)
      expect(params.signal?.aborted).toBe(false)
      params.onStreamEvent?.({ type: 'request-uploaded', transport: 'websocket', uploadDurationMs: 20_000 })
      await vi.advanceTimersByTimeAsync(11_000)
      expect(params.signal?.aborted).toBe(false)
      if (!acceptedDuringUpload) {
        params.onStreamEvent?.({ type: 'provider-event', providerEventType: 'accepted', requestAccepted: true })
      }
      await vi.advanceTimersByTimeAsync(20_000)
      expect(params.signal?.aborted).toBe(false)
      params.onToken?.('Done')
      params.onStreamEvent?.({ type: 'finish' })
      complete({ data: { choices: [{ message: { content: 'Done' } }] } })

      expect((await pending)?.output).toBe('Done')
      expect(state.agentLLMProvider.runChatCompletion).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('retains the initial inference allowance after HTTP fallback', async () => {
    vi.useFakeTimers()

    try {
      let params!: CompletionParams
      let complete!: (result: unknown) => void
      const manager = new LLMProvider()
      const state = manager as unknown as LLMProviderTestState

      state.agentLLMProvider = {
        modelName: 'celeris-1',
        transport: 'websocket',
        runChatCompletion: vi.fn((_prompt, options: CompletionParams) => {
          params = options
          params.onStreamEvent?.({ type: 'request-dispatched', transport: 'websocket' })
          return new Promise((resolve) => {
            complete = resolve
          })
        })
      }
      state.agentLLMProviderTargetLabel = celerisTarget.label

      const pending = manager.prompt('Think through the task.', {
        dutyType: LLMDuties.ReAct,
        shouldStream: true,
        timeout: 120_000
      })

      await vi.advanceTimersByTimeAsync(1_000)
      params.onStreamEvent?.({ type: 'request-dispatched', transport: 'http' })
      await vi.advanceTimersByTimeAsync(60_000)

      expect(params.signal?.aborted).toBe(false)
      expect(state.agentLLMProvider.runChatCompletion).toHaveBeenCalledOnce()
      params.onToken?.('Done')
      params.onStreamEvent?.({ type: 'finish' })
      complete({ data: { choices: [{ message: { content: 'Done' } }] } })

      expect((await pending)?.output).toBe('Done')
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['text', 'tool', 'final text'] as const)(
    'stops after %s stream silence while retaining progress and heartbeat evidence',
    async (output) => {
      vi.useFakeTimers()

      try {
        const attempts: CompletionParams[] = []
        const onAttempt = vi.fn()
        const runChatCompletion = vi.fn((_prompt, params: CompletionParams) => {
          attempts.push(params)
          params.onStreamEvent?.({ type: 'request-dispatched', transport: 'http' })

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
        await vi.advanceTimersByTimeAsync(10)
        attempts[0]!.onStreamEvent?.({ type: 'response-headers', requestId: 'req-test' })
        const promptCache = {
          key: 'opaque-session-key', systemHash: 'system-hash', toolsHash: 'tools-hash',
          inputItems: 4, previousInputItems: 2, matchingPrefixItems: 2, changedInputs: []
        }
        attempts[0]!.onStreamEvent?.({ type: 'prompt-cache', promptCache })
        await vi.advanceTimersByTimeAsync(10)
        attempts[0]!.onStreamEvent?.({ type: 'transport-activity' })
        await vi.advanceTimersByTimeAsync(10)
        attempts[0]!.onStreamEvent?.({ type: 'stream-open', transport: 'http' })
        await vi.advanceTimersByTimeAsync(39_970)
        expect(attempts[0]!.signal?.aborted).toBe(false)

        const progress = (): void => {
          if (output !== 'tool') {
            attempts[0]!.onToken?.('partial')
          } else {
            attempts[0]!.onStreamEvent?.({ type: 'tool-input-delta' })
          }
        }

        if (output === 'final text') {
          attempts[0]!.onStreamEvent?.({ type: 'text-start', preliminary: true })
          attempts[0]!.onToken?.('Checking.')
          attempts[0]!.onStreamEvent?.({ type: 'text-start', preliminary: false })
        }
        progress()
        await vi.advanceTimersByTimeAsync(29_000)
        progress()
        await vi.advanceTimersByTimeAsync(29_000)
        expect(attempts).toHaveLength(1)
        attempts[0]!.onStreamEvent?.({ type: 'transport-activity' })
        attempts[0]!.onStreamEvent?.({
          type: 'transport-heartbeat',
          heartbeat: { pingCount: 12, pongCount: 12, lastPingAt: Date.now(), lastPongAt: Date.now(), lastPongRttMs: 25 }
        })
        await vi.advanceTimersByTimeAsync(1_001)

        const result = await pending

        expect(attempts).toHaveLength(1)
        expect(attempts[0]!.signal?.aborted).toBe(true)
        expect(result).toBeNull()
        expect(LogHelper.error).toHaveBeenCalledWith(expect.stringContaining('req-test'))
        expect(LogHelper.error).toHaveBeenCalledWith(expect.stringContaining('LLMStreamIdleTimeout'))
        const timings = onAttempt.mock.calls.map(([timing]) => timing)

        expect(timings.map((timing) => timing.outcome)).toEqual([
          'started', 'LLMStreamIdleTimeout'
        ])
        expect(timings[1]).toMatchObject({
          attemptId: timings[0].attemptId,
          promptCache,
          retryDecision: 'stop', retryReason: 'partial_output_received',
          firstOutputMs: 40_000, pingCount: 12, pongCount: 12,
          lastPingAgeMs: 1_000, lastPongAgeMs: 1_000, lastPongRttMs: 25,
          requestDispatchMs: 0,
          responseHeadersMs: 10,
          firstByteMs: 20,
          streamOpenMs: 30,
          generationStartMs: 40_000,
          transportIdleMs: 1_000,
          outputIdleMs: 30_000,
          ...(output === 'tool' ? { firstToolInputMs: 40_000 } : { firstTokenMs: 40_000 })
        })
      } finally {
        vi.useRealTimers()
      }
    }
  )

  it.each(['reasoning', 'hosted tool', 'compaction'])('allows silent %s and reports actual text arrival', async (phase) => {
    vi.useFakeTimers()

    try {
      let params: CompletionParams | undefined
      const onAttempt = vi.fn()
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
        onAttempt,
        maxRetries: 0
      })

      await vi.advanceTimersByTimeAsync(0)
      let firstTokenAt = Date.now()
      if (phase === 'compaction') {
        params!.onToken?.('Done')
        params!.onStreamEvent?.({ type: 'text-end' })
      }
      params!.onStreamEvent?.(phase === 'reasoning'
        ? { type: 'reasoning-start' }
        : phase === 'compaction'
          ? { type: 'compaction-start' }
          : { type: 'tool-call', toolCallId: 'hosted', providerExecuted: true })
      await vi.advanceTimersByTimeAsync(60_000)
      expect(params!.signal?.aborted).toBe(false)
      params!.onStreamEvent?.(phase === 'reasoning'
        ? { type: 'reasoning-end' }
        : phase === 'compaction'
          ? { type: 'compaction-end' }
          : { type: 'tool-result', toolCallId: 'hosted' })

      if (phase !== 'compaction') {
        firstTokenAt = Date.now()
        if (phase === 'reasoning') {
          params!.onReasoningToken?.('Verified the result.')
        }
        params!.onToken?.('Done')
      }
      params!.onStreamEvent?.({ type: 'finish' })
      await vi.advanceTimersByTimeAsync(120_000)
      expect(params!.signal?.aborted).toBe(false)

      complete({ data: {
        choices: [{ message: { content: 'Done' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 1 }
      } })

      expect((await pending)?.firstTokenAt).toBe(firstTokenAt)
      expect(onAttempt.mock.calls.at(-1)?.[0].firstReasoningTokenMs).toBe(
        phase === 'reasoning' ? 60_000 : undefined
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['compaction', 'commentary'])('bounds silent %s even when transport heartbeats continue', async (phase) => {
    vi.useFakeTimers()

    try {
      let params!: CompletionParams
      const manager = new LLMProvider()
      const state = manager as unknown as LLMProviderTestState
      state.agentLLMProvider = {
        modelName: 'celeris-1',
        runChatCompletion: vi.fn((_prompt, options: CompletionParams) => {
          params = options
          if (phase === 'commentary') {
            params.onStreamEvent?.({ type: 'text-start', preliminary: true })
          }
          params.onToken?.('Drafted answer.')
          params.onStreamEvent?.({ type: 'text-end' })
          if (phase === 'compaction') {
            params.onStreamEvent?.({ type: 'compaction-start' })
          }

          return new Promise(() => {})
        })
      }
      state.agentLLMProviderTargetLabel = celerisTarget.label
      const pending = manager.prompt('Answer the question.', {
        dutyType: LLMDuties.ReAct, systemPrompt: '', shouldStream: true,
        timeout: 120_000, maxRetries: 0, remoteProviderErrorRetries: 0
      })

      await vi.advanceTimersByTimeAsync(60_000)
      expect(params.signal?.aborted).toBe(false)
      params.onStreamEvent?.({ type: 'transport-activity' })
      await vi.advanceTimersByTimeAsync(60_001)

      expect(await pending).toBeNull()
      expect(params.signal?.aborted).toBe(true)
      expect(state.agentLLMProvider.runChatCompletion).toHaveBeenCalledOnce()
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
