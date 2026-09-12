import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Client from '../../../app/src/js/client.js'

vi.mock('socket.io-client', () => ({ io: vi.fn() }))
vi.mock('../../../app/src/js/chatbot', () => ({ default: vi.fn() }))
vi.mock('../../../app/src/js/voice-energy', () => ({ default: vi.fn() }))
vi.mock('../../../app/src/js/suggestion-handler.js', () => ({ default: vi.fn() }))

describe('chat client answer streams', () => {
  let client
  let handlers
  let bubbles

  beforeEach(() => {
    vi.useFakeTimers()
    handlers = new Map()
    bubbles = new Map()
    vi.stubGlobal('window', {})
    vi.stubGlobal('document', {
      querySelector: (selector) => bubbles.get(selector.split('.').pop()),
      createElement: () => ({ textContent: '' })
    })
    client = Object.assign(Object.create(Client.prototype), {
      socket: { on: (event, handler) => handlers.set(event, handler) },
      voiceEnergy: { init: vi.fn() },
      history: null,
      _answerGenerationId: 'xxx',
      _activeStreamGenerationId: null,
      chatbot: {
        init: vi.fn(),
        scrollDown: vi.fn(),
        saveBubble: vi.fn(),
        formatMessage: (text) => text,
        updateBubbleMetrics: vi.fn(),
        createBubble: vi.fn(({ bubbleId, string }) => {
          const text = { innerHTML: string, appendChild: vi.fn() }
          const bubble = {
            querySelector: () => text,
            remove: () => bubbles.delete(bubbleId)
          }
          bubbles.set(bubbleId, bubble)
          return bubble
        })
      }
    })
    client.init()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('settles progress without duplication or saving it as a final answer', () => {
    handlers.get('leon:llm-token')({ generationId: 'progress', token: 'Checking' })
    handlers.get('leon:answer')({
      generationId: 'progress', answer: 'Checking the files.', historyMode: 'system_widget'
    })
    vi.runAllTimers()

    expect(client.chatbot.createBubble).toHaveBeenCalledOnce()
    expect(client.chatbot.saveBubble).not.toHaveBeenCalled()
    expect(bubbles.get('progress').querySelector().innerHTML).toBe('Checking the files.')

    handlers.get('leon:llm-token')({ generationId: 'final', token: 'Done' })
    handlers.get('leon:answer')({ answer: 'Done.' })
    vi.runAllTimers()

    expect(client.chatbot.createBubble).toHaveBeenCalledTimes(2)
    expect(client.chatbot.saveBubble).toHaveBeenCalledOnce()
    expect(bubbles.get('final').querySelector().innerHTML).toBe('Done.')
  })

  it('keeps a timed notice separate from an active stream', () => {
    handlers.get('leon:llm-token')({ generationId: 'draft', token: 'Hello' })
    handlers.get('leon:answer')({
      generationId: null, answer: 'Still working.', historyMode: 'system_widget'
    })
    expect(client._activeStreamGenerationId).toBe('draft')
    expect(bubbles.get('draft').querySelector().innerHTML).toBe('Hello')

    handlers.get('leon:llm-token')({ generationId: 'draft', token: ' world' })
    expect(client.chatbot.createBubble).toHaveBeenCalledTimes(2)
    expect(bubbles.get('draft').querySelector().appendChild).toHaveBeenCalledOnce()
  })

  it('removes rejected text and lets a non-streamed ending create its own bubble', () => {
    handlers.get('leon:llm-token')({ generationId: 'draft', token: 'Premature ending' })
    handlers.get('leon:llm-token')({ generationId: 'draft', token: '', reset: true })
    expect(bubbles.has('draft')).toBe(false)
    expect(client._activeStreamGenerationId).toBeNull()

    handlers.get('leon:answer')({ answer: 'The request failed.' })
    expect(client.chatbot.createBubble).toHaveBeenLastCalledWith(
      expect.objectContaining({ string: 'The request failed.', save: true })
    )
  })
})
