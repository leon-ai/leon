import { describe, expect, it, vi } from 'vitest'

import {
  buildAgentContinuationTranscript,
  buildAgentContinuityCheckpoint,
  type AgentContinuityCheckpointInput
} from '@/core/llm-manager/llm-duties/react-llm-duty/agent-loop-continuation'
import { prepareAgentModelContext } from '@/core/llm-manager/llm-duties/react-llm-duty/agent-context-budget'
import type { AgentToolTranscriptMessage } from '@/core/llm-manager/types'

function createCheckpointInput(): AgentContinuityCheckpointInput {
  return {
    originalInput: 'Prepare the release and preserve the exact artifact path.',
    trackedSteps: [
      { label: 'Build release', status: 'completed' },
      { label: 'Publish release', status: 'pending' }
    ],
    executionHistory: [
      {
        function: 'release.builder.run',
        status: 'success',
        observation: JSON.stringify({
          status: 'success',
          output_log_path: '/tmp/release-build.log'
        }),
        requestedToolInput: JSON.stringify({ target: 'linux' })
      },
      {
        function: 'release.publisher.run',
        status: 'error',
        observation: 'Publication failed because credentials are missing.'
      }
    ],
    loadedToolkitIds: ['release'],
    activeSkillId: 'release-workflow',
    clarificationQuestion: 'Which registry should I publish to?'
  }
}

function appendToolExchange(
  transcript: AgentToolTranscriptMessage[],
  index: number
): void {
  const id = `call-${index}`
  transcript.push(
    {
      role: 'assistant',
      content: '',
      toolCalls: [
        {
          id,
          type: 'function',
          function: {
            name: 'release__builder__run',
            arguments: JSON.stringify({ index })
          }
        }
      ]
    },
    {
      role: 'tool',
      toolCallId: id,
      toolName: 'release__builder__run',
      content: `Result ${index}: ${'detail '.repeat(100)}`
    }
  )
}

describe('agent loop continuation', () => {
  it('keeps a short transcript exact and adds deterministic resume state', async () => {
    const transcript: AgentToolTranscriptMessage[] = [
      { role: 'user', content: 'Prepare the release.' },
      { role: 'assistant', content: 'Which registry should I use?' }
    ]
    const summarize = vi.fn()

    const result = await buildAgentContinuationTranscript(
      transcript,
      summarize,
      createCheckpointInput()
    )

    expect(summarize).not.toHaveBeenCalled()
    expect(result.slice(0, transcript.length)).toEqual(transcript)
    expect(result.at(-1)?.content).toContain('<continuity_checkpoint>')
    expect(result.at(-1)?.content).toContain('/tmp/release-build.log')
    expect(result.at(-1)?.content).toContain('reported_plan')
    expect(result.at(-1)?.content).toContain('Publish release')
    expect(result.at(-1)?.content).toContain('release-workflow')
  })

  it('summarizes only older exchanges and retains the recent raw tail', async () => {
    const transcript: AgentToolTranscriptMessage[] = [
      { role: 'user', content: 'Prepare the release.' }
    ]
    for (let index = 1; index <= 16; index += 1) {
      appendToolExchange(transcript, index)
    }
    const summarize = vi.fn().mockResolvedValue('Older release work completed.')

    const result = await buildAgentContinuationTranscript(
      transcript,
      summarize,
      createCheckpointInput()
    )

    expect(summarize).toHaveBeenCalledOnce()
    expect(result.some((message) =>
      message.role === 'assistant' &&
      message.content.includes('<continuation_summary>')
    )).toBe(true)
    expect(result.some((message) =>
      message.role === 'assistant' &&
      message.content.startsWith('<continuity_checkpoint>')
    )).toBe(true)
    expect(result.some((message) =>
      message.role === 'tool' && message.toolCallId === 'call-16'
    )).toBe(true)
    expect(result.some((message) =>
      message.role === 'tool' && message.toolCallId === 'call-1'
    )).toBe(false)
  })

  it('uses deterministic state when semantic summarization fails', async () => {
    const transcript: AgentToolTranscriptMessage[] = [
      { role: 'user', content: 'Prepare the release.' }
    ]
    for (let index = 1; index <= 16; index += 1) {
      appendToolExchange(transcript, index)
    }

    const result = await buildAgentContinuationTranscript(
      transcript,
      vi.fn().mockResolvedValue(null),
      createCheckpointInput()
    )

    expect(JSON.stringify(result)).toContain('Semantic summary unavailable')
    expect(JSON.stringify(result)).toContain('<continuity_checkpoint>')
    expect(result.some((message) =>
      message.role === 'tool' && message.toolCallId === 'call-16'
    )).toBe(true)
    expect(result.some((message) =>
      message.role === 'tool' && message.toolCallId === 'call-1'
    )).toBe(false)
    expect(JSON.stringify(result).length).toBeLessThan(
      JSON.stringify(transcript).length
    )
  })

  it('hands exact older outcomes and failures to the summary before reducing text', async () => {
    const transcript: AgentToolTranscriptMessage[] = [
      { role: 'user', content: 'Download all requested documents.' }
    ]
    for (let index = 1; index <= 20; index += 1) appendToolExchange(transcript, index)
    transcript[2]!.content = JSON.stringify({ status: 'success', data: {
      controls: 'Historical controls. '.repeat(300),
      completed_document: '35D87BB7-0003', verified_path: '/tmp/invoice-0003.pdf'
    } })
    transcript[4]!.content = JSON.stringify({ status: 'error', data: {
      error_code: 'browser_consent_required', recovery: 'Use the existing GUI route.'
    } })
    const prepared = prepareAgentModelContext({
      transcript, systemPrompt: '', tools: [], compactionTriggerTokens: 2_000
    })
    expect(prepared.estimatedInputTokens).toBeGreaterThan(2_000)
    const summarize = vi.fn(async (history: string) => {
      expect(history).toContain('35D87BB7-0003')
      expect(history).toContain('/tmp/invoice-0003.pdf')
      expect(history).toContain('browser_consent_required')
      expect(history).not.toContain('content compacted')
      return 'Verified 35D87BB7-0003 at /tmp/invoice-0003.pdf. Browser inspection refused: browser_consent_required. Use the GUI route for remaining documents.'
    })
    const result = await buildAgentContinuationTranscript(prepared.transcript, summarize)
    expect(summarize).toHaveBeenCalledOnce()
    expect(JSON.stringify(result)).toContain('/tmp/invoice-0003.pdf')
    expect(result.slice(-16)).toEqual(transcript.slice(-16))
  })

  it('replaces an earlier deterministic checkpoint instead of stacking it', async () => {
    const checkpointInput = createCheckpointInput()
    const previousCheckpoint = buildAgentContinuityCheckpoint(checkpointInput)
    const transcript: AgentToolTranscriptMessage[] = [
      { role: 'user', content: 'Prepare the release.' },
      previousCheckpoint
    ]

    const result = await buildAgentContinuationTranscript(
      transcript,
      vi.fn(),
      {
        ...checkpointInput,
        clarificationQuestion: 'Which release channel should I use?'
      }
    )
    const checkpoints = result.filter((message) =>
      message.role === 'assistant' &&
      message.content.startsWith('<continuity_checkpoint>')
    )

    expect(checkpoints).toHaveLength(1)
    expect(checkpoints[0]?.content).toContain(
      'Which release channel should I use?'
    )
  })

  it('bounds checkpoint execution details to the recent state', () => {
    const checkpoint = buildAgentContinuityCheckpoint({
      ...createCheckpointInput(),
      executionHistory: Array.from({ length: 100 }, (_, index) => ({
        function: 'release.builder.run',
        status: 'success',
        observation: `Evidence ${index}: ${'detail '.repeat(500)}`
      }))
    })

    expect(checkpoint.content.length).toBeLessThan(7_000)
    expect(checkpoint.content).toContain('Evidence 99')
    expect(checkpoint.content).not.toContain('Evidence 93')
  })
})
