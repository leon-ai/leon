import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Client from '../../../app/src/js/client.js'
import { ModelResponseState } from '../../../server/src/core/leon-interface/types.ts'
import { CompletionFailureKind } from '../../../server/src/core/llm-manager/types.ts'

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
    bubbles.set('#model-response-status', { hidden: true, textContent: '' })
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
      activeSessionId: 'session-a',
      chatbot: {
        init: vi.fn(),
        isTyping: vi.fn(),
        scrollDown: vi.fn(),
        saveBubble: vi.fn(),
        formatMessage: (text) => text,
        renderStreamedMessage: (element, text) => {
          element.innerHTML = text
        },
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

    handlers.get('leon:llm-token')({
      generationId: 'retry', token: 'Incomplete attempt'
    })
    handlers.get('leon:llm-token')({
      generationId: 'retry', token: '', reset: true
    })

    expect(bubbles.has('retry')).toBe(false)
    expect(bubbles.get('progress').querySelector().innerHTML).toBe('Checking the files.')

    handlers.get('leon:llm-token')({ generationId: 'final', token: 'Done' })
    handlers.get('leon:answer')({ answer: 'Done.' })
    vi.runAllTimers()

    expect(client.chatbot.createBubble).toHaveBeenCalledTimes(3)
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
    expect(bubbles.get('draft').querySelector().innerHTML).toBe('Hello world')
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

  it('shows elapsed provider activity without adding bubbles and ignores stale or other-session completions', () => {
    const element = bubbles.get('#model-response-status')
    const status = {
      requestId: 'request-a', sessionId: 'session-a', startedAt: Date.now(),
      state: ModelResponseState.Waiting
    }
    const update = handlers.get('leon:model-response-status')
    update(status)
    vi.advanceTimersByTime(20_000)
    expect(element.textContent).toBe('Waiting for model response · Elapsed: 20 s')
    update({ ...status, state: ModelResponseState.Connected })
    expect(element.textContent).toContain('stream connected')
    update({ ...status, state: ModelResponseState.Reasoning })
    expect(element.textContent).toBe('Model is reasoning · Elapsed: 20 s')
    update({ ...status, sessionId: 'session-b' })
    update({ ...status, requestId: 'old-request', state: ModelResponseState.Completed })
    expect(element.hidden).toBe(false)
    expect(vi.getTimerCount()).toBe(1)
    expect(client.chatbot.createBubble).not.toHaveBeenCalled()
    expect(client.chatbot.saveBubble).not.toHaveBeenCalled()
    update({ ...status, state: ModelResponseState.Completed })
    expect(element.hidden).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['disconnect', 'turn-end', 'session-change'])(
    'clears transient status on %s', async (event) => {
      handlers.get('leon:model-response-status')({
        requestId: 'request', sessionId: 'session-a', startedAt: Date.now(),
        state: ModelResponseState.Waiting
      })
      if (event === 'disconnect') {
        handlers.get('disconnect')()
      } else if (event === 'turn-end') {
        handlers.get('leon:is-typing')(false)
      } else {
        client.socket.emit = vi.fn()
        client.chatbot.setSessionId = vi.fn()
        client.chatbot.loadFeed = vi.fn()
        await client.setActiveSession('session-b')
      }
      expect(bubbles.get('#model-response-status').hidden).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    }
  )

  it('shows the retry reason, provider silence and remaining total budget', () => {
    const status = {
      requestId: 'request-a', sessionId: 'session-a',
      startedAt: Date.now() - 120_000, deadlineAt: Date.now() + 60_000,
      state: ModelResponseState.Retrying, attempt: 1,
      retryReason: CompletionFailureKind.Timeout, lastActivityAt: Date.now() - 117_000
    }
    const update = handlers.get('leon:model-response-status')
    const element = bubbles.get('#model-response-status')
    update(status)
    expect(element.textContent).toContain('Retrying model response')
    expect(element.textContent).toContain('Previous attempt timed out')
    expect(element.textContent).toContain('Last provider activity: 1m 57s ago')
    update({ ...status, state: ModelResponseState.Waiting, attempt: 2, lastActivityAt: null })
    vi.advanceTimersByTime(1_000)
    expect(element.textContent).toContain('Attempt 2')
    expect(element.textContent).toContain('Elapsed: 2m 1s')
    expect(element.textContent).toContain('Time left: 59 s')
    expect(element.textContent).toContain('No provider activity yet')
    expect(client.chatbot.saveBubble).not.toHaveBeenCalled()
  })
})
