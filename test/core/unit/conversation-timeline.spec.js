import { describe, expect, it, vi } from 'vitest'

import { expandConversationTimeline } from '../../../app/src/js/conversation-timeline.js'
import ToolUIHandler from '../../../app/src/js/tool-ui-handler.js'

describe('conversation activity replay', () => {
  it('restores thinking and tools in time order without draft bubbles or duplicate cards', () => {
    const reasoning = { id: 'r1', text: 'Checking', phase: 'agent', startedAt: 2 }
    const toolCall = { id: 't1', name: 'test.lookup', status: 'running', startedAt: 3 }
    const trace = { id: 'turn', reasoning: [reasoning], toolCalls: [toolCall] }
    const messages = [
      { who: 'owner', string: 'Check it', sentAt: 1 },
      { who: 'leon', string: '', sentAt: 4, agentResponseTrace: trace },
      { who: 'leon', string: 'Working', sentAt: 4 },
      { who: 'leon', string: 'Done', sentAt: 5, agentResponseTrace: {
        ...trace, toolCalls: [{ ...toolCall, status: 'success' }]
      } }
    ]
    const timeline = expandConversationTimeline(messages).sort((a, b) => a.sentAt - b.sentAt)
    expect(timeline.map((item) => item.string || item.reasoning?.id || item.toolCall?.id))
      .toEqual(['Check it', 'r1', 't1', 'Working', 'Done'])
    expect(timeline[2].toolCall.status).toBe('success')

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
    handler.replayAgentResponseTrace({ toolCalls: [{ id: 't1', name: 'test.lookup', status: 'running' }] })
    expect(handler.handleToolOutput).toHaveBeenCalledOnce()
    expect(handler.handleToolOutput).toHaveBeenCalledWith(expect.objectContaining({ toolPhase: 'input' }))
  })
})
