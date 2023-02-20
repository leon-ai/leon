import Net from 'node:net'
import { EventEmitter } from 'node:events'

import { IS_PRODUCTION_ENV } from '@/constants'
import { OSTypes } from '@/types'
import { LogHelper } from '@/helpers/log-helper'
import { SystemHelper } from '@/helpers/system-helper'

// Time interval between each try (in ms)
const INTERVAL = IS_PRODUCTION_ENV ? 3000 : 500
// Number of retries to connect to the TCP server
const RETRIES_NB = IS_PRODUCTION_ENV ? 8 : 30

export default class TCPClient {
  private static instance: TCPClient

  private reconnectCounter = 0
  private tcpSocket = new Net.Socket()
  private _isConnected = false

  public readonly ee = new EventEmitter()

  get isConnected(): boolean {
    return this._isConnected
  }

  get status(): Net.SocketReadyState {
    return this.tcpSocket.readyState
  }

  constructor(private readonly host: string, private readonly port: number) {
    if (!TCPClient.instance) {
      LogHelper.title('TCP Client')
      LogHelper.success('New instance')

      TCPClient.instance = this
    }

    this.host = host
    this.port = port

    this.tcpSocket.on('connect', () => {
      LogHelper.title('TCP Client')
      LogHelper.success(
        `Connected to the TCP server tcp://${this.host}:${this.port}`
      )

      this.reconnectCounter = 0
      this._isConnected = true
      this.ee.emit('connected', null)
    })

    this.tcpSocket.on('data', (chunk: { topic: string, data: unknown }) => {
      LogHelper.title('TCP Client')
      LogHelper.info(`Received data: ${String(chunk)}`)

      const data = JSON.parse(String(chunk))
      this.ee.emit(data.topic, data.data)
    })

    this.tcpSocket.on('error', (err: NodeJS.ErrnoException) => {
      LogHelper.title('TCP Client')

      if (err.code === 'ECONNREFUSED') {
        this.reconnectCounter += 1

        const { type: osType } = SystemHelper.getInformation()

        if (this.reconnectCounter >= RETRIES_NB) {
          LogHelper.error('Failed to connect to the TCP server')
          this.tcpSocket.end()
        }

        if (this.reconnectCounter >= 1) {
          LogHelper.info('Trying to connect to the TCP server...')

          if (this.reconnectCounter >= 5) {
            if (osType === OSTypes.MacOS) {
              LogHelper.warning(
                'The cold start of the TCP server can take a few more seconds on macOS. It should be a one-time thing, no worries'
              )
            }
          }

          setTimeout(() => {
            this.connectSocket()
          }, INTERVAL * this.reconnectCounter)
        }
      } else {
        LogHelper.error(`Failed to connect to the TCP server: ${err}`)
      }

      this._isConnected = false
    })

    this.tcpSocket.on('end', () => {
      LogHelper.title('TCP Client')
      LogHelper.success('Disconnected from the TCP server')

      this._isConnected = false
    })
  }

  public connect(): void {
    setTimeout(() => {
      this.connectSocket()
    }, INTERVAL)
  }

  public emit(topic: string, data: unknown): void {
    const obj = {
      topic,
      data
    }

    this.tcpSocket.write(JSON.stringify(obj))
  }

  private connectSocket(): void {
    this.tcpSocket.connect({
      host: this.host,
      port: this.port
    })
  }
}
