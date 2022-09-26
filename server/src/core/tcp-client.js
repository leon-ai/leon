import Net from 'node:net'
import { EventEmitter } from 'node:events'

import { IS_PRODUCTION_ENV } from '@/constants'
import { LogHelper } from '@/helpers/log-helper'

// Time interval between each try (in ms)
const INTERVAL = IS_PRODUCTION_ENV ? 3000 : 300
// Number of retries to connect to the TCP server
const RETRIES_NB = IS_PRODUCTION_ENV ? 5 : 15

export default class TcpClient {
  constructor(host, port) {
    this.host = host
    this.port = port
    this.reconnectCounter = 0
    this.attempts = []
    this.tcpSocket = new Net.Socket()
    this._ee = new EventEmitter()
    this._status = this.tcpSocket.readyState
    this._isConnected = false

    LogHelper.title('TCP Client')
    LogHelper.success('New instance')

    this.tcpSocket.on('connect', () => {
      LogHelper.title('TCP Client')
      LogHelper.success(
        `Connected to the TCP server tcp://${this.host}:${this.port}`
      )

      this._isConnected = true
      this._ee.emit('connected', null)
    })

    this.tcpSocket.on('data', (chunk) => {
      LogHelper.title('TCP Client')
      LogHelper.info(`Received data: ${chunk.toString()}`)

      const data = JSON.parse(chunk)
      this._ee.emit(data.topic, data.data)
    })

    this.tcpSocket.on('error', (err) => {
      LogHelper.title('TCP Client')

      if (err.code === 'ECONNREFUSED') {
        this.reconnectCounter += 1

        if (this.reconnectCounter >= RETRIES_NB) {
          LogHelper.error('Failed to connect to the TCP server')
          this.tcpSocket.end()
        }

        if (this.reconnectCounter >= 1) {
          LogHelper.info('Trying to connect to the TCP server...')

          setTimeout(() => {
            this.connect()
          }, INTERVAL * this.reconnectCounter)
        }
      } else {
        LogHelper.error(`Failed to connect to the TCP server: ${err}`)
      }
    })

    this.tcpSocket.on('end', () => {
      LogHelper.title('TCP Client')
      LogHelper.success('Disconnected from the TCP server')
    })

    setTimeout(() => {
      this.connect()
    }, INTERVAL)
  }

  get status() {
    return this._status
  }

  get ee() {
    return this._ee
  }

  get isConnected() {
    return this._isConnected
  }

  emit(topic, data) {
    const obj = {
      topic,
      data
    }

    this.tcpSocket.write(JSON.stringify(obj))
  }

  connect() {
    this.tcpSocket.connect({
      host: this.host,
      port: this.port
    })
  }
}
