import { EventEmitter } from 'events'

import server from '@/core/http-server/server'

describe('server', () => {
  describe('init()', () => {
    test('uses default language if the given one is unsupported', async () => {
      server.bootstrap = jest.fn() // Need to mock bootstrap method to not continue the init
      process.env.LEON_LANG = 'fake-lang'

      await server.init()
      expect(process.env.LEON_LANG).toBe('en-US')
    })

    test('initializes server configurations', async () => {
      await expect(server.init()).resolves.not.toThrow()
    })
  })

  describe('bootstrap()', () => {
    test('initializes HTTP server', async () => {
      await server.bootstrap()
      expect(server.httpServer).not.toBe({ })
    })
  })

  describe('listen()', () => {
    test('listens for request', async () => {
      console.log = jest.fn()

      await server.listen(process.env.LEON_PORT)
      expect(console.log.mock.calls[1][1].indexOf(`${process.env.LEON_HOST}:${process.env.LEON_PORT}`)).not.toEqual(-1)
    })
  })

  describe('handleOnConnection()', () => {
    test('initializes main nodes', async () => {
      // Mock the WebSocket with an EventEmitter
      const ee = new EventEmitter()
      ee.broadcast = { emit: jest.fn() }
      console.log = jest.fn()

      server.handleOnConnection(ee)

      expect(console.log.mock.calls[0][1]).toBe('CLIENT')
      console.log = jest.fn()

      ee.emit('init', 'hotword-node')
      console.log = jest.fn()

      ee.emit('hotword-detected', { })
      expect(console.log.mock.calls[0][1]).toBe('SOCKET')
      console.log = jest.fn()

      ee.emit('init', 'jest')

      /* setTimeout(() => {
        ee.emit('query', { client: 'jest', value: 'Hello' })
      }, 50)

      setTimeout(() => {
        expect(console.log.mock.calls[26][1]).toBe('Query found')
        console.log = jest.fn()
      }, 100)

      setTimeout(() => {
        ee.emit('recognize', 'blob')
      }, 150)

      setTimeout(async () => {
        expect(console.log.mock.calls[0][1]).toBe('ASR')
        console.log = jest.fn()

        await server.httpServer.close()
      }, 200) */
    })
  })
})
