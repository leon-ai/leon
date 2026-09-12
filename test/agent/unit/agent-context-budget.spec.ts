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

function createComputerUseToolCall(id: string): OpenAIToolCall {
  return {
    id,
    type: 'function',
    function: {
      name: 'computer_use__cua__get_window_state',
      arguments: JSON.stringify({ pid: 42, window_id: 7 })
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
  it.each(['computer_use__cua__get_window_state', 'browser_use__cli__screenshot'])('keeps only the two most recent %s screenshots', (toolName) => {
    const transcript: AgentToolTranscriptMessage[] = [
      { role: 'user', content: 'Operate the app.' }
    ]
    for (let index = 1; index <= 4; index += 1) {
      transcript.push({
        role: 'tool',
        toolCallId: `cua-${index}`,
        toolName,
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

  it('preserves older computer-use evidence below the context budget', () => {
    const transcript: AgentToolTranscriptMessage[] = [
      { role: 'user', content: 'Operate the app.' }
    ]
    for (let index = 1; index <= 7; index += 1) {
      const toolCall = createComputerUseToolCall(`cua-${index}`)
      transcript.push(
        { role: 'assistant', content: '', toolCalls: [toolCall] },
        {
          role: 'tool',
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          content: JSON.stringify({
            status: 'success',
            data: `capture ${index} `.repeat(200)
          })
        }
      )
    }

    const context = prepareAgentModelContext({
      transcript,
      systemPrompt: 'Use tools.',
      tools: [],
      compactionTriggerTokens: 96_000
    })

    expect(context.wasCompacted).toBe(false)
    expect(context.transcript).toEqual(transcript)
  })

  it('exposes pressure to semantic continuity without clipping evidence on recovery', () => {
    const transcript: AgentToolTranscriptMessage[] = [
      { role: 'user', content: 'Download the remaining documents.' }
    ]
    for (let index = 0; index < 20; index += 1) {
      appendToolExchange(transcript, String(index), JSON.stringify({
        status: index === 0 ? 'error' : 'success',
        data: { output: {
          elements: 'Captured controls. '.repeat(300),
          document_id: `document-${index}`,
          ...(index === 0 ? { error_code: 'browser_consent_required' } : {})
        } }
      }))
    }
    const context = prepareAgentModelContext({
      transcript, systemPrompt: 'Use tools.', tools: [],
      compactionTriggerTokens: 2_000,
      forceCompaction: true
    })
    expect(context.estimatedInputTokens).toBeGreaterThan(2_000)
    expect(context.transcript).toEqual(transcript)
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

    expect(context.estimatedInputTokens).toBeGreaterThan(100)
    expect(context.transcript).toEqual(transcript)
  })
})
