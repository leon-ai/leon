import { describe, expect, it, vi } from 'vitest'

import { AgentAnswerStream } from '@/core/llm-manager/llm-duties/react-llm-duty/agent-answer-stream'

describe('agent answer streaming', () => {
  it('delivers chunks immediately and finishes without replaying accepted progress', () => {
    const emit = vi.fn()
    const stream = new AgentAnswerStream(emit)

    stream.push('Checking')
    expect(emit).toHaveBeenCalledOnce()
    const generationId = emit.mock.calls[0]?.[0].generationId
    stream.push(' the files.')
    expect(emit).toHaveBeenLastCalledWith({ token: ' the files.', generationId })
    expect(stream.finish()).toBe(generationId)

    stream.discard()
    expect(emit).toHaveBeenCalledTimes(2)
    stream.push('Done.')
    expect(emit.mock.calls[2]?.[0].generationId).not.toBe(generationId)
  })

  it.each(['', null])('removes a provisional draft on retry or rejection: %j', (marker) => {
    const emit = vi.fn()
    const stream = new AgentAnswerStream(emit)
    stream.push('Incomplete draft')
    const generationId = emit.mock.calls[0]?.[0].generationId

    if (marker === '') stream.push(marker)
    else stream.discard()

    expect(emit).toHaveBeenLastCalledWith({ token: '', generationId, reset: true })
    stream.push('Corrected answer')
    expect(emit.mock.calls[2]?.[0].generationId).not.toBe(generationId)
  })
})
