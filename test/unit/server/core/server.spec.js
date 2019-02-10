'use strict'

import net from 'net'
import { EventEmitter } from 'events'

import Server from '@/core/server'

describe('server', () => {
  const bootstrapTmp = Server.bootstrap
  const listenTmp = Server.listen

  describe('constructor()', () => {
    test('creates a new instance of Server', () => {
      const server = new Server()

      expect(server).toBeInstanceOf(Server)
    })
  })

  describe('init()', () => {
    test('uses default language if there is an unsupported one', async () => {
      Server.bootstrap = jest.fn() // Need to mock bootstrap method to not continue the init
      process.env.LEON_LANG = 'fake-lang'

      await Server.init()
      expect(process.env.LEON_LANG).toBe('en-US')
      Server.bootstrap = bootstrapTmp // Need to give back the real bootstrap method
    })

    test('executes bootstrap', async () => {
      Server.bootstrap = jest.fn()

      await Server.init()
      expect(Server.bootstrap).toHaveBeenCalledTimes(1)
      Server.bootstrap = bootstrapTmp // Need to give back the real bootstrap method
    })
  })

  describe('bootstrap()', () => {
    test('executes listening', async () => {
      Server.listen = jest.fn()

      await Server.bootstrap()
      expect(Server.listen).toHaveBeenCalledTimes(1)
      Server.listen = listenTmp // Need to give back the real listen method
    })
  })

  describe('listen()', () => {
    test('listens port already in use', async () => {
      const server = net.createServer()
      server.once('error', (err) => {
        expect(err.code).toBe('EADDRINUSE')
        server.close()
        Server.server.close()
      })

      await Server.listen(process.env.LEON_SERVER_PORT)
      server.listen(process.env.LEON_SERVER_PORT)
    })
  })

  // TODO: something more elegant
  describe('connection()', () => {
    test('initializes main nodes', (done) => {
      // Mock the WebSocket with an EventEmitter
      const ee = new EventEmitter()
      ee.broadcast = { emit: jest.fn() }
      console.log = jest.fn()

      Server.connection(ee)

      expect(console.log.mock.calls[0][1]).toBe('CLIENT')
      console.log = jest.fn()

      ee.emit('init', 'hotword-node')
      console.log = jest.fn()

      setTimeout(() => {
        ee.emit('hotword-detected', { })
        expect(console.log.mock.calls[0][1]).toBe('SOCKET')
        console.log = jest.fn()
      }, 1000)

      setTimeout(() => {
        ee.emit('init', 'testing')
        expect(console.log.mock.calls[0][1]).toBe('BRAIN')
        console.log = jest.fn()
      }, 2000)

      setTimeout(() => {
        ee.emit('query', { client: 'jest', value: 'Hello' })
        expect(console.log.mock.calls[0][1]).toBe('NLU')
        console.log = jest.fn()

        ee.emit('recognize', { })
        expect(console.log.mock.calls[0][1]).toBe('ASR')
        console.log = jest.fn()

        done()
      }, 3000)
    })
  })
})
