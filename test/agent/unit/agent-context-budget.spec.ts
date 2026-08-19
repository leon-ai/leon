import { describe, expect, it } from 'vitest'

import {
  prepareAgentModelContext,
  resolveAgentContextCompactionTriggerTokens,
  resolveAgentContextRecoveryTriggerTokens,
  resolveAgentMaxOutputTokens
} from '@/core/llm-manager/llm-duties/react-llm-duty/agent-context-budget'
import { LOCAL_LLM_CONTEXT_WINDOW_TOKENS } from '@/core/llm-manager/model-context-windows'
import type {
  AgentToolTranscriptMessage,
  OpenAIToolCall
} from '@/core/llm-manager/types'
import { LLMProviders } from '@/core/llm-manager/types'

function createToolCall(id: string): OpenAIToolCall {
  return {
    id,
    type: 'function',
    function: {
      name: 'test__shell__run',
      arguments: JSON.stringify({ command: `inspect-${id}` })
    }
  }
}

function appendToolExchange(
  transcript: AgentToolTranscriptMessage[],
  id: string,
  content: string
): void {
  transcript.push(
    {
      role: 'assistant',
      content: '',
      toolCalls: [createToolCall(id)]
    },
    {
      role: 'tool',
      toolCallId: id,
      toolName: 'test__shell__run',
      content
    }
  )
}

describe('agent context budget', () => {
  it('keeps only the two most recent computer-use screenshots', () => {
    const transcript: AgentToolTranscriptMessage[] = [
      { role: 'user', content: 'Operate the app.' }
    ]
    for (let index = 1; index <= 4; index += 1) {
      transcript.push({
        role: 'tool',
        toolCallId: `cua-${index}`,
        toolName: 'computer_use__cua__get_window_state',
        content: `Capture ${index}`,
        files: [
          {
            dataBase64: 'x'.repeat(100_000),
            mediaType: 'image/png'
          }
        ]
      })
    }

    const context = prepareAgentModelContext({
      transcript,
      systemPrompt: 'Use tools.',
      tools: [],
      compactionTriggerTokens: 10_000
    })
    const toolMessages = context.transcript.filter(
      (message) => message.role === 'tool'
    )

    expect(toolMessages[0]).not.toHaveProperty('files')
    expect(toolMessages[1]).not.toHaveProperty('files')
    expect(toolMessages[2]).toHaveProperty('files')
    expect(toolMessages[3]).toHaveProperty('files')
    expect(context.wasCompacted).toBe(false)
    expect(context.estimatedInputTokens).toBeLessThan(10_000)
  })

  it('uses 75% of the shared local context window', () => {
    expect(
      resolveAgentContextCompactionTriggerTokens(LLMProviders.LlamaCPP)
    ).toBe(
      Math.floor(LOCAL_LLM_CONTEXT_WINDOW_TOKENS * 0.75)
    )
    expect(
      resolveAgentContextCompactionTriggerTokens(LLMProviders.SGLang)
    ).toBe(Math.floor(LOCAL_LLM_CONTEXT_WINDOW_TOKENS * 0.75))
  })

  it('uses a universal 96K trigger for remote providers', () => {
    expect(
      resolveAgentContextCompactionTriggerTokens(LLMProviders.OpenAI)
    ).toBe(96_000)
    expect(
      resolveAgentContextCompactionTriggerTokens(LLMProviders.Anthropic)
    ).toBe(96_000)
    expect(
      resolveAgentContextCompactionTriggerTokens(LLMProviders.OpenRouter)
    ).toBe(96_000)
  })

  it('uses a smaller 50% local and 64K remote recovery target', () => {
    expect(
      resolveAgentContextRecoveryTriggerTokens(LLMProviders.LlamaCPP)
    ).toBe(Math.floor(LOCAL_LLM_CONTEXT_WINDOW_TOKENS * 0.5))
    expect(
      resolveAgentContextRecoveryTriggerTokens(LLMProviders.OpenAI)
    ).toBe(64_000)
  })

  it('uses the remaining local context capacity for model output', () => {
    const estimatedInputTokens = Math.floor(
      LOCAL_LLM_CONTEXT_WINDOW_TOKENS * 0.75
    )

    expect(
      resolveAgentMaxOutputTokens(
        LLMProviders.LlamaCPP,
        estimatedInputTokens
      )
    ).toBe(
      LOCAL_LLM_CONTEXT_WINDOW_TOKENS -
        estimatedInputTokens -
        Math.floor(LOCAL_LLM_CONTEXT_WINDOW_TOKENS * 0.05)
    )
    expect(
      resolveAgentMaxOutputTokens(LLMProviders.SGLang, 0)
    ).toBe(
      LOCAL_LLM_CONTEXT_WINDOW_TOKENS -
        Math.floor(LOCAL_LLM_CONTEXT_WINDOW_TOKENS * 0.05)
    )
  })

  it('leaves remote output limits to their providers', () => {
    expect(
      resolveAgentMaxOutputTokens(LLMProviders.OpenAI, 12_000)
    ).toBeUndefined()
  })

  it('progressively compacts old completed exchanges until the prompt fits', () => {
    const transcript: AgentToolTranscriptMessage[] = [
      { role: 'user', content: 'Inspect everything.' }
    ]
    for (let index = 1; index <= 7; index += 1) {
      appendToolExchange(
        transcript,
        `call-${index}`,
        JSON.stringify({
          status: 'success',
          message: `Inspection ${index} completed.`,
          data: 'result '.repeat(400)
        })
      )
    }

    const context = prepareAgentModelContext({
      transcript,
      systemPrompt: 'Use tools.',
      tools: [],
      compactionTriggerTokens: 1_600
    })

    expect(context.compactedToolExchangeCount).toBeGreaterThan(0)
    expect(context.estimatedInputTokens).toBeLessThanOrEqual(1_600)
    expect(context.transcript).toContainEqual(
      expect.objectContaining({
        role: 'assistant',
        content: expect.stringContaining(
          'earlier_completed_tool_exchange_compacted'
        )
      })
    )
    expect(context.transcript).toContainEqual(
      expect.objectContaining({ role: 'tool', toolCallId: 'call-7' })
    )
  })

  it('preserves failure details and artifact paths in compacted exchanges', () => {
    const transcript: AgentToolTranscriptMessage[] = [
      { role: 'user', content: 'Inspect the files.' }
    ]
    appendToolExchange(
      transcript,
      'old-call',
      JSON.stringify({
        status: 'error',
        message: 'The inspection command failed.',
        output_log_path: '/tmp/tool-artifacts/old-call.log',
        observed_tool_failure: true,
        data: 'failure details '.repeat(300)
      })
    )
    appendToolExchange(transcript, 'recent-call-1', 'Recent result one.')
    appendToolExchange(transcript, 'recent-call-2', 'Recent result two.')

    const context = prepareAgentModelContext({
      transcript,
      systemPrompt: 'Use tools.',
      tools: [],
      compactionTriggerTokens: 1,
      forceCompaction: true
    })
    const compactedMessage = context.transcript.find(
      (message) =>
        message.role === 'assistant' &&
        message.content.includes('earlier_completed_tool_exchange_compacted')
    )

    expect(compactedMessage?.content).toContain('test__shell__run')
    expect(compactedMessage?.content).toContain('failed_tools')
    expect(compactedMessage?.content).toContain(
      '/tmp/tool-artifacts/old-call.log'
    )
    expect(context.transcript).not.toContainEqual(
      expect.objectContaining({ role: 'tool', toolCallId: 'old-call' })
    )
  })

  it('bounds a compacted exchange containing parallel tool calls', () => {
    const oldCalls = Array.from({ length: 6 }, (_, index) =>
      createToolCall(`old-${index + 1}`)
    )
    const transcript: AgentToolTranscriptMessage[] = [
      { role: 'user', content: 'Inspect every source.' },
      {
        role: 'assistant',
        content: 'Checking the sources.',
        toolCalls: oldCalls
      },
      ...oldCalls.map((call, index) => ({
        role: 'tool' as const,
        toolCallId: call.id,
        toolName: call.function.name,
        content: JSON.stringify({
          status: index === 5 ? 'error' : 'success',
          message: `Source ${index + 1} checked.`,
          output_log_path: `/tmp/tool-artifacts/source-${index + 1}.log`,
          data: 'result '.repeat(300)
        })
      }))
    ]
    appendToolExchange(transcript, 'recent-call-1', 'Recent result one.')
    appendToolExchange(transcript, 'recent-call-2', 'Recent result two.')

    const context = prepareAgentModelContext({
      transcript,
      systemPrompt: 'Use tools.',
      tools: [],
      compactionTriggerTokens: 1,
      forceCompaction: true
    })
    const compactedMessage = context.transcript.find(
      (message) =>
        message.role === 'assistant' &&
        message.content.includes('earlier_completed_tool_exchange_compacted')
    )

    expect(compactedMessage?.content.length).toBeLessThanOrEqual(1_200)
    expect(compactedMessage?.content).toContain(
      '/tmp/tool-artifacts/source-6.log'
    )
    expect(compactedMessage?.content).toContain('failed_tools')
  })

  it('compacts oversized recent parallel exchanges until the target fits', () => {
    const transcript: AgentToolTranscriptMessage[] = [
      { role: 'user', content: 'Inspect every source.' }
    ]
    for (let exchangeIndex = 1; exchangeIndex <= 2; exchangeIndex += 1) {
      const calls = Array.from({ length: 20 }, (_, index) =>
        createToolCall(`batch-${exchangeIndex}-${index}`)
      )
      transcript.push(
        { role: 'assistant', content: '', toolCalls: calls },
        ...calls.map((call) => ({
          role: 'tool' as const,
          toolCallId: call.id,
          toolName: call.function.name,
          content: JSON.stringify({
            status: 'success',
            message: `Completed ${call.id}.`,
            data: 'result '.repeat(200)
          })
        }))
      )
    }

    const context = prepareAgentModelContext({
      transcript,
      systemPrompt: 'Use tools.',
      tools: [],
      compactionTriggerTokens: 2_000,
      forceCompaction: true
    })

    expect(context.estimatedInputTokens).toBeLessThanOrEqual(2_000)
    expect(context.compactedToolExchangeCount).toBe(2)
    expect(context.transcript.some((message) => message.role === 'tool')).toBe(
      false
    )
  })

  it('merges accumulated compacted exchanges into one bounded history record', () => {
    const transcript: AgentToolTranscriptMessage[] = [
      { role: 'user', content: 'Inspect all sources.' }
    ]
    for (let index = 1; index <= 12; index += 1) {
      appendToolExchange(
        transcript,
        `call-${index}`,
        JSON.stringify({
          status: 'success',
          message: `Source ${index} checked.`,
          output_log_path: `/tmp/tool-artifacts/source-${index}.log`,
          data: 'result '.repeat(400)
        })
      )
    }

    const context = prepareAgentModelContext({
      transcript,
      systemPrompt: 'Use tools.',
      tools: [],
      compactionTriggerTokens: 2_500
    })
    const compactedMessages = context.transcript.filter(
      (message) =>
        message.role === 'assistant' &&
        message.content.includes('earlier_completed_tool_exchange_compacted')
    )

    expect(context.estimatedInputTokens).toBeLessThanOrEqual(2_500)
    expect(compactedMessages).toHaveLength(1)
    expect(compactedMessages[0]?.content).toContain('merged_exchange_count')
    expect(compactedMessages[0]?.content).toContain(
      '/tmp/tool-artifacts/source-1.log'
    )
  })

  it('reports an irreducibly oversized prompt without altering conversation messages', () => {
    const transcript: AgentToolTranscriptMessage[] = [
      { role: 'user', content: 'large request '.repeat(1_000) }
    ]

    const context = prepareAgentModelContext({
      transcript,
      systemPrompt: 'Use tools.',
      tools: [],
      compactionTriggerTokens: 100
    })

    expect(context.compactedToolExchangeCount).toBe(0)
    expect(context.estimatedInputTokens).toBeGreaterThan(100)
    expect(context.transcript).toEqual(transcript)
  })
})
