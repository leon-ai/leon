import { beforeEach, describe, expect, it, vi } from 'vitest'

import LLMProvider from '@/core/llm-manager/llm-provider'
import { LLMDuties, LLMProviders } from '@/core/llm-manager/types'

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
