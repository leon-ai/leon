import { describe, expect, it, vi } from 'vitest'

import { AgentAnswerStream } from '@/core/llm-manager/llm-duties/react-llm-duty/agent-answer-stream'

describe('agent answer streaming', () => {
  it('buffers chunks and publishes accepted progress once', () => {
    const emit = vi.fn()
    const stream = new AgentAnswerStream(emit)

    stream.push('Checking')
    expect(emit).not.toHaveBeenCalled()
    stream.push(' the files.')
    expect(emit).not.toHaveBeenCalled()
    const generationId = stream.finish()

    expect(emit).toHaveBeenCalledExactlyOnceWith({
      token: 'Checking the files.',
      generationId
    })

    stream.discard()
    expect(emit).toHaveBeenCalledOnce()
    stream.push('Done.')
    expect(stream.finish()).not.toBe(generationId)
    expect(emit).toHaveBeenCalledTimes(2)
  })

  it.each(['', null])(
    'discards a private draft on retry or rejection: %j',
    (marker) => {
      const emit = vi.fn()
      const stream = new AgentAnswerStream(emit)

      stream.push('Incomplete draft')
      expect(emit).not.toHaveBeenCalled()

    if (marker === '') stream.push(marker)
    else stream.discard()

      expect(emit).not.toHaveBeenCalled()
      stream.push('Corrected answer')
      stream.finish()
      expect(emit).toHaveBeenCalledExactlyOnceWith({
        token: 'Corrected answer',
        generationId: expect.any(String)
      })
    }
  )
})
