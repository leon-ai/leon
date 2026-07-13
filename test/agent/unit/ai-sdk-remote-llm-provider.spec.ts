import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResolvedLLMTarget } from '@/core/llm-manager/llm-routing'
import type {
  CompletionParams,
  PromptOrChatHistory
} from '@/core/llm-manager/types'
import { LLMDuties, LLMProviders } from '@/core/llm-manager/types'
import OpenRouterLLMProvider from '@/core/llm-manager/llm-providers/openrouter-llm-provider'

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
    getProviderAPIKeyEnv: vi.fn(() => null)
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
  buildCallOptions(
    prompt: PromptOrChatHistory,
    completionParams: CompletionParams
  ): Record<string, unknown>
  runChatCompletion(
    prompt: PromptOrChatHistory,
    completionParams: CompletionParams
  ): Promise<{ data: Record<string, unknown> }>
}

function createOpenRouterProvider(): ProviderWithPrivateCallOptions {
  const target: ResolvedLLMTarget = {
    provider: LLMProviders.OpenRouter,
    model: 'qwen/qwen3.7-max',
    label: 'openrouter/qwen/qwen3.7-max',
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

describe('AISDKRemoteLLMProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('preserves streaming length finishes for agent recovery', async () => {
    openRouterMocks.languageModel.doStream.mockResolvedValue({
      stream: (async function* (): AsyncGenerator<Record<string, unknown>> {
        yield {
          type: 'finish',
          finishReason: 'length',
          usage: {
            inputTokens: { total: 100 },
            outputTokens: { total: 1_024 }
          }
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
  })
})
