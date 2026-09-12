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
})
