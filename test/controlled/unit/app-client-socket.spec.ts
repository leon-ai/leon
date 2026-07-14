import { beforeEach, describe, expect, it, vi } from 'vitest'

const socketMocks = vi.hoisted(() => {
  const callOrder: string[] = []
  const socket = {
    connect: vi.fn(() => {
      callOrder.push('connect')
    }),
    emit: vi.fn(),
    on: vi.fn((eventName: string) => {
      callOrder.push(`on:${eventName}`)
    })
  }

  return {
    callOrder,
    io: vi.fn(() => socket),
    socket
  }
})

vi.mock('socket.io-client', () => ({ io: socketMocks.io }))
vi.mock('../../../app/src/js/chatbot', () => ({
  default: class ChatbotMock {
    public parsedBubbles: unknown[] = []

    public init(): Promise<void> {
      return Promise.resolve()
    }
  }
}))
vi.mock('../../../app/src/js/voice-energy', () => ({
  default: class VoiceEnergyMock {
    public init(): void {}
  }
}))
vi.mock('../../../app/src/js/suggestion-handler.js', () => ({
  default: vi.fn()
}))

import Client from '../../../app/src/js/client'

describe('web app client socket', () => {
  beforeEach(() => {
    socketMocks.callOrder.length = 0
    vi.stubGlobal('document', {
      querySelector: vi.fn(() => null)
    })
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null)
    })
    vi.stubGlobal('window', {
      leonConfigInfo: {
        tcpServer: { enabled: true }
      }
    })
  })

  it('connects only after registering lifecycle listeners', () => {
    const client = new Client('webapp', '', { value: '' })

    expect(socketMocks.io).toHaveBeenCalledWith('', {
      withCredentials: true,
      autoConnect: false
    })
    expect(socketMocks.socket.connect).not.toHaveBeenCalled()

    client.init()

    expect(socketMocks.socket.connect).toHaveBeenCalledOnce()
    expect(socketMocks.callOrder.at(-1)).toBe('connect')
    expect(socketMocks.callOrder).toContain('on:connect')
    expect(socketMocks.callOrder).toContain('on:leon:ready')
  })
})
