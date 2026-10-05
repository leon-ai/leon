import { describe, expect, it, vi } from 'vitest'

import { expandConversationTimeline } from '../../../app/src/js/conversation-timeline.js'
import ToolUIHandler from '../../../app/src/js/tool-ui-handler.js'
import { formatToolDuration } from '../../../web-app/src/utils/format-tool-duration.ts'

describe('conversation activity replay', () => {
  it('restores thinking and tools in time order without draft bubbles or duplicate cards', () => {
    const reasoning = { id: 'r1', text: 'Checking', phase: 'agent', startedAt: 2 }
    const laterReasoning = {
      id: 'r2', text: 'Reading the result', phase: 'agent', startedAt: 5
    }
    const toolCall = { id: 't1', name: 'test.lookup', status: 'running', startedAt: 3 }
    const progress = {
      id: 'progress', content: 'One item is verified; more remain.', createdAt: 4
    }
    const trace = {
      id: 'turn', reasoning: [reasoning], toolCalls: [toolCall],
      progressMessages: [progress]
    }
    const messages = [
      { who: 'owner', string: 'Check it', sentAt: 1 },
      { who: 'leon', string: '', sentAt: 4, agentResponseTrace: trace },
      { who: 'leon', string: 'Working', sentAt: 4 },
      { who: 'leon', string: 'Done', sentAt: 6, agentResponseTrace: {
        ...trace,
        reasoning: [reasoning, laterReasoning],
        toolCalls: [{ ...toolCall, status: 'success' }]
      } }
    ]
    const timeline = expandConversationTimeline(messages).sort((a, b) => a.sentAt - b.sentAt)
    expect(timeline.map((item) => item.string || item.originalString || item.reasoning?.id || item.toolCall?.id))
      .toEqual(['Check it', 'r1', 't1', progress.content, 'Working', 'r2', 'Done'])
    expect(timeline[2].toolCall.status).toBe('success')
    expect(timeline[3].messageId).toBe(progress.id)

    const legacy = expandConversationTimeline([{
      who: 'leon', string: 'Old answer', sentAt: 9,
      agentResponseTrace: { toolCalls: [{ id: 'old', name: 'test.lookup', status: 'success' }] }
    }])
    expect(legacy[0].toolCall.id).toBe('old')
    expect(legacy[1].string).toBe('Old answer')
  })

  it('does not turn an in-progress tool into a completed result on reload', () => {
    const handler = Object.create(ToolUIHandler.prototype)
    handler.handleToolOutput = vi.fn()
    handler.replayAgentResponseTrace({ toolCalls: [{
      id: 't1', name: 'test.lookup', status: 'running', toolCallTitle: 'Look up the requested value'
    }] })
    expect(handler.handleToolOutput).toHaveBeenCalledOnce()
    expect(handler.handleToolOutput).toHaveBeenCalledWith(expect.objectContaining({
      toolPhase: 'input', toolCallTitle: 'Look up the requested value'
    }))
  })

  it.each([
    [138, '138 ms'],
    [0, '0 ms'],
    [1_400, '1.4 s'],
    [130_000, '2m 10s'],
    [119_999, '2m 0s'],
    [undefined, ''],
    [Number.NaN, ''],
    [-1, '']
  ])('formats a duration of %s as "%s"', (durationMs, expected) => {
    expect(formatToolDuration(durationMs)).toBe(expected)
  })

  it.each(['success', 'error', 'background'])(
    'restores and displays a %s tool title and duration from history',
    (outcome) => {
      const handler = Object.create(ToolUIHandler.prototype)
      const card = {
        title: {},
        subtitle: {},
        summary: {},
        statusChip: {},
        durationLabel: { hidden: true }
      }
      handler.setStatusChip = vi.fn()
      handler.renderOutputPreview = vi.fn()
      handler.renderValuePreview = vi.fn()
      handler.renderPlaceholder = vi.fn()
      handler.renderRawData = vi.fn()
      handler.handleToolOutput = (data) => handler.updateActivityCard(card, data, 'lookup')
      handler.replayAgentResponseTrace({
        toolCalls: [{
          id: 't1',
          name: 'test.lookup.run',
          toolkitName: 'Test Toolkit',
          toolName: 'Official Lookup',
          toolCallTitle: 'Look up the requested value',
          stepLabel: 'test.lookup.run',
          status: outcome === 'error' ? 'error' : 'success',
          durationMs: 1_400,
          output: outcome === 'background'
            ? { execution: { id: 'job-1', state: 'running' } }
            : { value: 42 }
        }]
      })

      expect(card.durationLabel.hidden).toBe(false)
      expect(card.title.textContent).toBe('Look up the requested value')
      expect(card.subtitle.textContent).toBe('Test Toolkit toolkit • Official Lookup • Run')
      expect(card.durationLabel.textContent).toBe(
        outcome === 'background' ? '1.4 s to return' : '1.4 s'
      )
    }
  )

  it('uses readable toolkit and tool labels when older traces lack display names', () => {
    const handler = Object.create(ToolUIHandler.prototype)
    handler.handleToolOutput = vi.fn()
    handler.replayAgentResponseTrace({
      toolCalls: [{
        id: 'old',
        name: 'system_utilities.tool_executions.read',
        status: 'success'
      }]
    })

    for (const [data] of handler.handleToolOutput.mock.calls) {
      expect(data).toMatchObject({
        toolkitName: 'System Utilities',
        toolName: 'Tool Executions',
        functionName: 'read'
      })
    }
  })
})
