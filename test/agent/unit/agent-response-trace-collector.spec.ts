import { describe, expect, it, vi } from 'vitest'

import { AgentResponseTraceCollector } from '@/core/llm-manager/llm-duties/react-llm-duty/agent-response-trace-collector'
import { deserializeAgentTrace, serializeAgentTrace } from '@/core/http-server/http-plugins/leon-services/agent-trace-serializer'
import { LLMDuties, LLMProviders } from '@/core/llm-manager/types'

describe('AgentResponseTraceCollector', () => {
  it('separates argument preparation from dispatch and preserves both timestamps through replay', () => {
    const collector = new AgentResponseTraceCollector()
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const toolCall = { id: 'tool', name: 'test.lookup' }

    collector.record({ type: 'tool_call', toolCall: { ...toolCall, status: 'preparing' } })
    const preparing = collector.snapshot({})

    expect(preparing.toolCalls[0]).toMatchObject({ preparationStartedAt: 1_000 })
    expect(preparing.toolCalls[0]).not.toHaveProperty('startedAt')

    now.mockReturnValue(20_000)
    collector.record({ type: 'tool_call', toolCall: { ...toolCall, status: 'running' } })
    collector.record({ type: 'tool_call', toolCall: {
      ...toolCall, status: 'running', commandOutput: 'Python fixture\n',
      lastOutputAt: 20_010, progressMessage: 'Checking remote access.'
    } })
    now.mockReturnValue(20_050)
    collector.record({ type: 'tool_call', toolCall: {
      ...toolCall, status: 'success', durationMs: 50
    } })
    const finished = collector.snapshot({})

    expect(finished.toolCalls[0]).toMatchObject({
      preparationStartedAt: 1_000, startedAt: 20_000, durationMs: 50,
      commandOutput: 'Python fixture\n', lastOutputAt: 20_010,
      progressMessage: 'Checking remote access.'
    })
    expect(deserializeAgentTrace(serializeAgentTrace(finished, false)).toolCalls)
      .toEqual(finished.toolCalls)
    expect(preparing.toolCalls[0]?.status).toBe('preparing')

    collector.record({ type: 'tool_call', toolCall: {
      id: 'canceled', name: 'test.lookup', status: 'preparing'
    } })
    collector.interrupt()
    expect(collector.snapshot({}).toolCalls[1]).toMatchObject({ status: 'error' })
    expect(collector.snapshot({}).toolCalls[1]).not.toHaveProperty('startedAt')
  })

  it('retains separate inference attempts and their latest timing across replay and reset', () => {
    const collector = new AgentResponseTraceCollector()
    const attempt = {
      attemptId: 'attempt-1', startedAt: 1_000, provider: LLMProviders.OpenAI,
      duty: LLMDuties.ReAct, phase: 'agent' as const, transport: 'http' as const,
      outcome: 'started', elapsedMs: 0, inferenceTimeoutMs: 120_000,
      streamIdleTimeoutMs: 30_000, lastEvent: 'dispatched'
    }

    collector.recordInference(attempt)
    const pending = collector.snapshot({})
    collector.recordInference({ ...attempt, outcome: 'LLMStreamIdleTimeout', elapsedMs: 30_000 })
    collector.recordInference({
      ...attempt, attemptId: 'attempt-2', startedAt: 31_000,
      outcome: 'completed', elapsedMs: 5_000, streamOpenMs: 100,
      generationStartMs: 4_000, firstToolInputMs: 4_000, lastEvent: 'finish'
    })
    const finished = collector.snapshot({})

    expect(finished.inferences).toHaveLength(2)
    expect(finished.inferences?.[0]?.outcome).toBe('LLMStreamIdleTimeout')
    expect(pending.inferences?.[0]?.outcome).toBe('started')
    expect(deserializeAgentTrace(serializeAgentTrace(finished, false)).inferences)
      .toEqual(finished.inferences)
    collector.reset()
    expect(collector.snapshot({}).inferences).toBeUndefined()
  })

  it('preserves ordered commentary through replay and HTTP history without duplicating it', () => {
    const collector = new AgentResponseTraceCollector()
    const first = { id: 'progress-1', content: 'Inspecting the issue.', createdAt: 1_000 }
    const second = { id: 'progress-2', content: 'Reading the result.', createdAt: 2_000 }
    collector.record({ type: 'progress_message', message: first })
    collector.record({ type: 'progress_message', message: second })
    collector.record({ type: 'progress_message', message: first })
    collector.interrupt()
    const trace = collector.snapshot({})
    expect(trace.progressMessages).toEqual([first, second])
    expect(deserializeAgentTrace(serializeAgentTrace(trace, false)).progressMessages)
      .toEqual([first, second])
    collector.reset()
    expect(collector.snapshot({}).progressMessages).toBeUndefined()
  })
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
        toolCallTitle: 'Inspect the current screen',
        toolkitName: 'Computer Use',
        toolName: 'Cua',
        input: { display: 0 }
      }
    })
    collector.record({
      type: 'tool_call',
      toolCall: {
        id: 'tool-1',
        name: 'computer_use.cua.get_screenshot',
        status: 'success',
        durationMs: 138,
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
          toolCallTitle: 'Inspect the current screen',
          toolkitName: 'Computer Use',
          toolName: 'Cua',
          startedAt: 1_000,
          durationMs: 138,
          input: { display: 0 },
          output: { artifact: 'screen.png' }
        }
      ],
      metrics: { totalTokens: 42 }
    })
    const trace = collector.snapshot({})
    expect(serializeAgentTrace(trace, false).tool_calls[0]).toMatchObject({
      toolkit_name: 'Computer Use',
      tool_name: 'Cua'
    })
    expect(deserializeAgentTrace(serializeAgentTrace(trace, false)).toolCalls)
      .toEqual(trace.toolCalls)

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
