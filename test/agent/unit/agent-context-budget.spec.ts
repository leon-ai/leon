import { describe, expect, it } from 'vitest'

import {
  buildBoundedToolObservation,
  prepareAgentModelContext,
  resolveAgentContextCompactionTriggerTokens,
  resolveAgentContextRecoveryTriggerTokens,
  resolveAgentMaxOutputTokens,
  retainRecentToolImages,
  reuseToolContext
} from '@/core/llm-manager/llm-duties/react-llm-duty/agent-context-budget'
import { LOCAL_LLM_CONTEXT_WINDOW_TOKENS } from '@/core/llm-manager/model-context-windows'
import type {
  AgentToolTranscriptMessage,
  OpenAITool,
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
  it('reuses visible context, refreshes changed content and restores it after compaction', () => {
    const result = (id: string, content: string): AgentToolTranscriptMessage => ({
      role: 'tool', toolCallId: id, toolName: 'source',
      content: JSON.stringify({ data: { output: {
        instructions: [{ modelContextId: 'workspace/rules', content }]
      } } })
    })
    const transcript = [
      result('first', 'Follow these rules.'),
      result('repeat', 'Follow these rules.'),
      result('changed', 'Follow the current rules.'),
      result('reverted', 'Follow these rules.')
    ]
    const original = JSON.stringify(transcript)
    const projected = reuseToolContext(transcript)

    expect(projected[0]).toBe(transcript[0])
    expect(JSON.parse(projected[1]!.content).data.output.instructions[0]).toEqual({
      modelContextId: 'workspace/rules',
      contentReference: 'Unchanged context; complete content is in tool call first.'
    })
    expect(projected[2]).toBe(transcript[2])
    expect(projected[3]).toBe(transcript[3])
    expect(reuseToolContext(transcript.slice(1))[0]).toBe(transcript[1])
    expect(JSON.stringify(transcript)).toBe(original)
  })

  it('keeps reusable context isolated by tool and leaves ordinary evidence intact', () => {
    const content = JSON.stringify({ data: {
      parsed_input: { modelContextId: 'rules', content: 'Read me.' },
      output: { modelContextId: 'rules', content: 'Read me.' }
    } })
    const transcript: AgentToolTranscriptMessage[] = [
      { role: 'tool', toolCallId: 'a', toolName: 'first', content },
      { role: 'tool', toolCallId: 'b', toolName: 'second', content },
      { role: 'tool', toolCallId: 'c', toolName: 'first', content: 'Read me.' }
    ]

    expect(reuseToolContext(transcript)).toEqual(transcript)
  })

  it('restores full context when pressure removes the earlier complete source', () => {
    const context = { modelContextId: 'workspace', content: 'Required context. '.repeat(300) }
    const observation = JSON.stringify({
      status: 'success', output_log_path: '/logs/source.json',
      data: { output: { result: context } }
    })
    const transcript: AgentToolTranscriptMessage[] = [{
      role: 'tool', toolCallId: 'source',
      toolName: 'computer_use__cua__get_window_state', content: observation
    }]
    for (let index = 0; index < 8; index += 1) {
      appendToolExchange(transcript, `read-${index}`, 'Observed evidence.')
    }
    transcript.push({ ...transcript[0]!, toolCallId: 'latest' } as AgentToolTranscriptMessage)

    const prepared = prepareAgentModelContext({
      transcript, systemPrompt: 'Inspect context.', tools: [],
      compactionTriggerTokens: 100_000, forceCompaction: true
    })

    expect(prepared.transcript[0]!.content).not.toBe(observation)
    expect(prepared.transcript.at(-1)!.content).toBe(observation)
    expect(transcript[0]!.content).toBe(observation)
  })

  it('batches image removals while preserving the request prefix between removals', () => {
    const transcript: AgentToolTranscriptMessage[] = []
    const image = { dataBase64: 'image', mediaType: 'image/png' }
    const appendImage = (id: string): void => {
      appendToolExchange(transcript, id, 'Inspected image.')
      const message = transcript.at(-1)!
      if (message.role === 'tool') {
        message.files = [image]
      }
    }

    appendImage('one')
    appendImage('two')
    appendImage('three')
    expect(retainRecentToolImages(transcript)).toEqual(transcript)

    appendImage('four')
    const removed = retainRecentToolImages(transcript)
    expect(removed[1]).not.toHaveProperty('files')
    expect(removed[3]).not.toHaveProperty('files')
    expect(removed[5]).toHaveProperty('files')
    expect(removed[7]).toHaveProperty('files')

    appendImage('five')
    expect(retainRecentToolImages(transcript).slice(0, removed.length)).toEqual(removed)
    expect(transcript[1]).toHaveProperty('files')
  })

  it('keeps a default retained-result page complete in the model observation', () => {
    const content = 'x'.repeat(8_000)
    const observation = {
      status: 'success',
      data: { output: { result: {
        execution: { id: 'original-result', state: 'completed' },
        content: JSON.stringify(content), value: content, truncated: false
      } } }
    }

    const result = JSON.parse(buildBoundedToolObservation(observation))

    expect(result.data.output.result).toEqual({
      execution: { id: 'original-result', state: 'completed' },
      value: content, truncated: false
    })
    expect(observation.data.output.result.content).toBe(JSON.stringify(content))
  })

  it('preserves projection text when decoding cannot retain its exact number', () => {
    const content = '9007199254740993'
    const observation = { data: { output: { result: {
      execution: { id: 'original-result', state: 'completed' },
      content, value: JSON.parse(content), truncated: false
    } } } }

    expect(JSON.parse(buildBoundedToolObservation(observation))).toEqual(observation)
  })

  it('retains complete review capabilities while exposing context pressure', () => {
    const tools: OpenAITool[] = [
      'load_toolkit',
      'file_system__file__read',
      'weather__openmeteo__getWeather'
    ].map((name) => ({
      type: 'function',
      function: { name, description: name, parameters: { type: 'object' } }
    }))
    const params = {
      transcript: [{ role: 'user' as const, content: 'Review the evidence.' }],
      systemPrompt: 'Review completion.',
      tools,
      compactionTriggerTokens: 1,
      forceCompaction: true
    }

    expect(prepareAgentModelContext(params).tools.length).toBeLessThan(tools.length)

    const review = prepareAgentModelContext({ ...params, preserveToolSchemas: true })

    expect(review.tools).toEqual(tools)
    expect(review.estimatedInputTokens).toBeGreaterThan(params.compactionTriggerTokens)
  })

  it('budgets native context tokens without counting ciphertext or source snapshots', () => {
    const context = {
      provider: LLMProviders.OpenAI, model: 'gpt-6.1-sol', binding: 'connection',
      output: [{ type: 'compaction', id: 'cmp', encrypted_content: 'x'.repeat(100_000) }],
      estimatedTokens: 500,
      sourceTranscript: [{ role: 'user' as const, content: 'Evidence '.repeat(100_000) }]
    }
    const transcript: AgentToolTranscriptMessage[] = [{
      role: 'assistant', content: 'Generated response', compactionContext: context,
      reasoningItems: [{ provider: LLMProviders.OpenAI, id: 'rs', text: '', encryptedContent: 'x'.repeat(100_000) }]
    }]
    const prepared = prepareAgentModelContext({
      transcript, systemPrompt: '', tools: [], compactionTriggerTokens: 1_000,
      forceCompaction: true
    })

    expect(prepared.estimatedInputTokens).toBeGreaterThanOrEqual(500)
    expect(prepared.estimatedInputTokens).toBeLessThan(1_000)
    expect(prepared.transcript[0]).toEqual(transcript[0])
  })

  it('preserves UI text until context pressure requires reloadable evidence to shrink', () => {
    const transcript: AgentToolTranscriptMessage[] = []
    for (let index = 0; index < 12; index += 1) {
      transcript.push({ role: 'tool', toolCallId: String(index),
        toolName: 'computer_use__cua__get_window_state',
        content: JSON.stringify({ status: index === 1 ? 'error' : 'success',
          ...(index !== 2 ? { output_log_path: `/logs/${index}.json` } : {}),
          data: { output: { elements: 'Old screen '.repeat(400) } } }) })
    }
    const original = JSON.stringify(transcript)
    const normal = prepareAgentModelContext({
      transcript, systemPrompt: '', tools: [], compactionTriggerTokens: 96_000
    })

    expect(normal.transcript).toEqual(transcript)
    expect(normal.wasCompacted).toBe(false)

    const result = prepareAgentModelContext({
      transcript, systemPrompt: '', tools: [], compactionTriggerTokens: 1
    })
    expect(result.transcript[0]!.content.length).toBeLessThan(1_500)
    expect(result.transcript[0]!.content).toContain('/logs/0.json')
    expect(result.transcript[1]).toEqual(transcript[1])
    expect(result.transcript[2]).toEqual(transcript[2])
    expect(result.transcript.slice(-8)).toEqual(transcript.slice(-8))
    expect(JSON.stringify(transcript)).toBe(original)
    expect(result.estimatedInputTokens).toBeLessThan(result.estimatedInputTokensBeforePreparation)
  })
  it.each([
    'computer_use__cua__get_window_state',
    'browser_use__cli__screenshot',
    'file_system__file__readImage',
    'file_system__file__readPdf'
  ])('keeps only the two most recent %s image results', (toolName) => {
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

  it('preserves a complete parallel inspection batch and reloadable older evidence', () => {
    const image = { dataBase64: 'x'.repeat(100_000), mediaType: 'image/png' }
    const document = { dataBase64: 'document', mediaType: 'application/pdf' }
    const transcript: AgentToolTranscriptMessage[] = [
      { role: 'user', content: 'Inspect these documents.', files: [image] }
    ]

    appendToolExchange(transcript, 'older', JSON.stringify({
      status: 'success',
      data: { path: '/tmp/older.pdf', figure_count: 3 }
    }))
    const olderResult = transcript.at(-1)!
    if (olderResult.role === 'tool') {
      olderResult.files = [image, document]
    }

    const calls = ['first', 'second', 'third'].map(createToolCall)
    transcript.push({ role: 'assistant', content: '', toolCalls: calls })
    for (const call of calls) {
      transcript.push({
        role: 'tool',
        toolCallId: call.id,
        toolName: call.function.name,
        content: JSON.stringify({ path: `/tmp/${call.id}.pdf` }),
        files: [image, image]
      })
    }
    appendToolExchange(transcript, 'save', 'Verified counts saved.')

    const original = structuredClone(transcript)
    const context = prepareAgentModelContext({
      transcript,
      systemPrompt: '',
      tools: [],
      compactionTriggerTokens: 96_000
    })

    expect(context.transcript[0]).toEqual(original[0])
    expect(context.transcript[2]).toEqual({
      ...original[2],
      files: [document]
    })
    expect(context.transcript.slice(3)).toEqual(original.slice(3))
    expect(transcript).toEqual(original)
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
