import Net from 'node:net'
import { EventEmitter } from 'node:events'

import { ASR_PROVIDER, IS_PRODUCTION_ENV } from '@/constants'
import { ASR_ENGINE } from '@/core'
import { OSTypes } from '@/types'
import { LogHelper } from '@/helpers/log-helper'
import { SystemHelper } from '@/helpers/system-helper'
import { ASRProviders } from '@/core/asr/types'

// Time interval between each try (in ms)
const INTERVAL = IS_PRODUCTION_ENV ? 3000 : 500
// Number of retries to connect to the TCP server
const RETRIES_NB = IS_PRODUCTION_ENV ? 8 : 30

export interface ChunkData {
  topic: string
  data: Record<string, unknown>
}
type TCPClientName = 'Python'

export default class TCPClient {
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

  constructor(
    private readonly name: TCPClientName,
    private readonly host: string,
    private readonly port: number
  ) {
    LogHelper.title(`${name} TCP Client`)
    LogHelper.success('New instance')

    this.name = name
    this.host = host
    this.port = port

    this.tcpSocket.on('connect', () => {
      LogHelper.title(`${this.name} TCP Client`)
      LogHelper.success(
        `Connected to the ${this.name} TCP server at tcp://${this.host}:${this.port}`
      )

      this.reconnectCounter = 0
      this._isConnected = true
      this.ee.emit('connected', null)
    })

    this.tcpSocket.on('data', (chunk: ChunkData) => {
      LogHelper.title(`${this.name} TCP Client`)
      LogHelper.info(`Received data: ${String(chunk)}`)

      const strChunk = String(chunk)

      /**
       * If the topic is related to ASR, then parse the data manually
       * in the local ASR parser
       */
      if (strChunk.includes('"topic": "asr-')) {
        if (ASR_PROVIDER === ASRProviders.Local) {
          ASR_ENGINE.parser?.parse(strChunk)
        }
      } else {
        try {
          const data = JSON.parse(strChunk)

          this.ee.emit(data.topic, data.data)
        } catch (e) {
          LogHelper.title(`${this.name} TCP Client`)
          LogHelper.error(`Failed to parse the data: ${e}`)
          LogHelper.error(`Received data: ${String(chunk)}`)
        }
      }
    })

    this.tcpSocket.on('error', (err: NodeJS.ErrnoException) => {
      LogHelper.title(`${this.name} TCP Client`)

      if (err.code === 'ECONNREFUSED') {
        this.reconnectCounter += 1

        const { type: osType } = SystemHelper.getInformation()

        if (this.reconnectCounter >= RETRIES_NB) {
          LogHelper.error(`Failed to connect to the ${this.name} TCP server`)
          this.tcpSocket.end()
        }

        if (this.reconnectCounter >= 1) {
          LogHelper.info(`Trying to connect to the ${this.name} TCP server...`)

          if (this.reconnectCounter >= 5) {
            if (osType === OSTypes.MacOS) {
              LogHelper.warning(
                `The cold start of the ${this.name} TCP server can take a few more seconds on macOS. It should be a one-time thing, no worries`
              )
            }
          }

          setTimeout(() => {
            this.connectSocket()
          }, INTERVAL * this.reconnectCounter)
        }
      } else {
        LogHelper.error(
          `Failed to connect to the ${this.name} TCP server: ${err}`
        )
      }

      this._isConnected = false
    })

    this.tcpSocket.on('end', () => {
      LogHelper.title(`${this.name} TCP Client`)
      LogHelper.success(`Disconnected from the ${this.name} TCP server`)

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
