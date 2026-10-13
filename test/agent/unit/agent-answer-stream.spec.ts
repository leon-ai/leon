import { describe, expect, it, vi } from 'vitest'

import { AgentAnswerStream } from '@/core/llm-manager/llm-duties/react-llm-duty/agent-answer-stream'

describe('agent answer streaming', () => {
  it('streams chunks immediately and settles without replaying accepted text', () => {
    const emit = vi.fn()
    const stream = new AgentAnswerStream(emit)

    stream.push('  ')
    expect(emit).not.toHaveBeenCalled()
    stream.push(' Checking')
    expect(emit).toHaveBeenCalledExactlyOnceWith({
      token: 'Checking', generationId: expect.any(String)
    })
    stream.push(' the files.')
    expect(emit).toHaveBeenCalledTimes(2)
    const generationId = stream.finish()

    expect(emit).toHaveBeenLastCalledWith({
      token: ' the files.',
      generationId
    })

    stream.discard()
    expect(emit).toHaveBeenCalledTimes(2)
    stream.push('Done.')
    expect(stream.finish()).not.toBe(generationId)
    expect(emit).toHaveBeenCalledTimes(3)
  })

  it.each(['', null])(
    'resets a visible draft on retry or rejection: %j',
    (marker) => {
      const emit = vi.fn()
      const stream = new AgentAnswerStream(emit)

      stream.push('Incomplete draft')
      const generationId = emit.mock.calls[0]![0].generationId

      if (marker === '') {
        stream.push(marker)
      } else {
        stream.discard()
      }

      expect(emit).toHaveBeenLastCalledWith({ token: '', generationId, reset: true })
      stream.push('Corrected answer')
      stream.finish()
      expect(emit).toHaveBeenCalledTimes(3)
      expect(emit).toHaveBeenLastCalledWith({
        token: 'Corrected answer',
        generationId: expect.any(String)
      })
      expect(emit.mock.calls[2]![0].generationId).not.toBe(generationId)
    }
  )
})
