import net from 'net'
import { EventEmitter } from 'events'

import Server from '@/core/server'

describe('server', () => {
  describe('constructor()', () => {
    test('creates a new instance of Server', () => {
      const server = new Server()

      expect(server).toBeInstanceOf(Server)
      expect(server.brain).toBeEmpty()
    })
  })

  describe('init()', () => {
    test('uses default language if there is an unsupported one', async () => {
      const server = new Server()

      server.bootstrap = jest.fn() // Need to mock bootstrap method to not continue the init
      process.env.LEON_LANG = 'fake-lang'

      await server.init()
      expect(process.env.LEON_LANG).toBe('en-US')
    })
  })

  describe('bootstrap()', () => {
    test('initializes HTTP server', async () => {
      const server = new Server()

      await server.bootstrap()
      expect(server.httpServer).not.toBeEmpty()
      await server.httpServer.close()
    })
  })

  describe('listen()', () => {
    test('listens port already in use', async () => {
      const fakeServer = net.createServer()

      fakeServer.once('error', (err) => {
        expect(err.code).toBe('EADDRINUSE')
        fakeServer.close()
      })

      const server = new Server()
      await server.init()

      fakeServer.listen(process.env.LEON_PORT)
      await server.httpServer.close()
    })

    test('listens for request', async () => {
      const server = new Server()
      console.log = jest.fn()

      await server.listen(process.env.LEON_PORT)
      expect(console.log.mock.calls[0][1].indexOf(process.env.LEON_PORT)).not.toBe(-1)
    })
  })

  describe('connection()', () => {
    test('initializes main nodes', async (done) => {
      const server = new Server()

      await server.init()

      // Mock the WebSocket with an EventEmitter
      const ee = new EventEmitter()
      ee.broadcast = { emit: jest.fn() }
      console.log = jest.fn()

      await server.connection(ee)

      expect(console.log.mock.calls[0][1]).toBe('CLIENT')
      console.log = jest.fn()

      ee.emit('init', 'hotword-node')
      console.log = jest.fn()

      ee.emit('hotword-detected', { })
      expect(console.log.mock.calls[0][1]).toBe('SOCKET')
      console.log = jest.fn()

      ee.emit('init', 'jest')
      expect(server.brain).not.toBeEmpty()
      expect(server.nlu).not.toBeEmpty()
      expect(server.asr).not.toBeEmpty()

      done()
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

        done()
      }, 200) */
    })
  })
})
