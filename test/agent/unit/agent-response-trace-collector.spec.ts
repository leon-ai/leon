import { describe, expect, it, vi } from 'vitest'

import { AgentResponseTraceCollector } from '@/core/llm-manager/llm-duties/react-llm-duty/agent-response-trace-collector'

describe('AgentResponseTraceCollector', () => {
  it('merges progressive tool activity into one durable trace', () => {
    const collector = new AgentResponseTraceCollector()
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)

    collector.record({
      type: 'reasoning_summary',
      summary: 'Checking the current application'
    })
    collector.record({
      type: 'plan_step',
      step: { id: 'plan-1', label: 'Inspect the screen', status: 'in_progress' }
    })
    collector.record({
      type: 'tool_call',
      toolCall: {
        id: 'tool-1',
        name: 'computer_use.cua.get_screenshot',
        status: 'running',
        input: { display: 0 }
      }
    })
    collector.record({
      type: 'tool_call',
      toolCall: {
        id: 'tool-1',
        name: 'computer_use.cua.get_screenshot',
        status: 'success',
        output: { artifact: 'screen.png' }
      }
    })

    expect(collector.snapshot({ totalTokens: 42 })).toEqual({
      reasoningSummary: 'Checking the current application',
      planSteps: [
        { id: 'plan-1', label: 'Inspect the screen', status: 'in_progress' }
      ],
      planTransitions: [
        {
          id: 'plan-1',
          label: 'Inspect the screen',
          status: 'in_progress',
          changedAt: 1_000
        }
      ],
      toolCalls: [
        {
          id: 'tool-1',
          name: 'computer_use.cua.get_screenshot',
          status: 'success',
          startedAt: 1_000,
          input: { display: 0 },
          output: { artifact: 'screen.png' }
        }
      ],
      metrics: { totalTokens: 42 }
    })

    now.mockRestore()
  })

  it('records only actual plan changes with their transition time', () => {
    const collector = new AgentResponseTraceCollector()
    const now = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(2_000)

    collector.record({
      type: 'plan_step',
      step: { id: 'plan-1', label: 'Inspect source', status: 'in_progress' }
    })
    collector.record({
      type: 'plan_step',
      step: { id: 'plan-1', label: 'Inspect source', status: 'in_progress' }
    })
    collector.record({
      type: 'plan_step',
      step: { id: 'plan-1', label: 'Inspect source', status: 'completed' }
    })

    expect(collector.snapshot({}).planTransitions).toEqual([
      {
        id: 'plan-1',
        label: 'Inspect source',
        status: 'in_progress',
        changedAt: 1_000
      },
      {
        id: 'plan-1',
        label: 'Inspect source',
        status: 'completed',
        changedAt: 2_000
      }
    ])

    now.mockRestore()
  })

  it('preserves displayed reasoning and unfinished tools on interruption, then resets', () => {
    const collector = new AgentResponseTraceCollector()
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
    collector.reset('turn-1')
    collector.recordReasoning('thinking-1', 'Checking ', 'agent')
    collector.record({
      type: 'tool_call',
      toolCall: { id: 'tool-1', name: 'test.lookup', status: 'running' }
    })
    const draft = collector.snapshot({})
    vi.mocked(Date.now).mockReturnValue(2_000)
    collector.recordReasoning('thinking-1', 'the result.', 'agent')
    collector.interrupt()

    expect(collector.snapshot({})).toMatchObject({
      id: 'turn-1',
      reasoning: [{ id: 'thinking-1', text: 'Checking the result.', phase: 'agent', startedAt: 1_000 }],
      toolCalls: [{ id: 'tool-1', status: 'error', startedAt: 1_000 }]
    })
    expect(draft.reasoning?.[0]?.text).toBe('Checking ')
    expect(draft.toolCalls[0]?.status).toBe('running')
    collector.reset('turn-2')
    expect(collector.snapshot({})).toEqual({ id: 'turn-2', planSteps: [], toolCalls: [], metrics: {} })
  })
})
