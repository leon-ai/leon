import type { WebSocket } from 'ws'
import { WebSocketServer } from 'ws'

import { LANG, HAS_STT, HAS_TTS } from '@/constants'
import {
  HTTP_SERVER,
  TCP_CLIENT,
  ASR,
  STT,
  TTS,
  NLU,
  BRAIN,
  MODEL_LOADER
} from '@/core'
import { LogHelper } from '@/helpers/log-helper'
import { LangHelper } from '@/helpers/lang-helper'

interface SocketMessage {
  event: string
  sentAt: number // Timestamp
  client: string
  data: unknown
}

interface HotwordDetectedMessage extends SocketMessage {
  data: {
    hotword: string
    buffer: Buffer
  }
}

interface UtteranceMessage extends SocketMessage {
  data: string
}

interface RecognizeMessage extends SocketMessage {
  data: Buffer
}

enum WSReadyState {
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3
}

export default class SocketServer {
  private static instance: SocketServer
  private wsServer: WebSocketServer | undefined = undefined

  public socket: WebSocket | undefined = undefined

  constructor() {
    if (!SocketServer.instance) {
      LogHelper.title('Socket Server')
      LogHelper.success('New instance')

      SocketServer.instance = this
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public sendSocketMessage(event: string, data: any = null): void {
    if (!this.socket || this.socket.readyState !== WSReadyState.OPEN) {
      LogHelper.title('Socket Server')
      LogHelper.error('Socket not ready')
      return
    }

    this.socket.send(
      JSON.stringify({
        event,
        data,
        sentAt: Date.now()
      })
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public broadcastSocketMessage(event: string, data: any = null): void {
    if (!this.wsServer) {
      LogHelper.title('Socket Server')
      LogHelper.error('WebSocket server not ready')
      return
    }

    this.wsServer.clients.forEach((client) => {
      client.send(
        JSON.stringify({
          event,
          data,
          sentAt: Date.now()
        })
      )
    })
  }

  /**
   * Handle on hotward detected
   */
  private onHotwordDetectedMessage(message: HotwordDetectedMessage): void {
    if (message.event === 'hotword-detected') {
      // Hotword triggered
      LogHelper.title('Socket')
      LogHelper.success(`Hotword ${message.data.hotword} detected`)

      this.broadcastSocketMessage('enable-record')
    }
  }

  /**
   * Handle on utterance
   */
  private async onUtteranceMessage(message: UtteranceMessage): Promise<void> {
    // Listen for new utterance
    if (message.event === 'utterance') {
      const { data: utterance, client } = message

      LogHelper.title('Socket')
      LogHelper.info(`${client} emitted: ${utterance}`)

      this.sendSocketMessage('is-typing', true)

      try {
        LogHelper.time('Utterance processed in')

        BRAIN.isMuted = false
        await NLU.process(utterance)

        LogHelper.title('Execution Time')
        LogHelper.timeEnd('Utterance processed in')
      } catch (e) {
        LogHelper.error(`Failed to process utterance: ${e}`)
      }
    }
  }

  /**
   * Handle on automatic speech recognition
   */
  private async onRecognizeMessage(message: RecognizeMessage): Promise<void> {
    if (message.event === 'recognize') {
      const { data: string } = message

      console.log('string', string)

      try {
        await ASR.encode(Buffer.from(string, 'base64'))
      } catch (e) {
        LogHelper.error(`ASR - Failed to encode audio blob to WAVE file: ${e}`)
      }
    }
  }

  public async init(): Promise<void> {
    /**
     * @see https://github.com/websockets/ws/blob/HEAD/doc/ws.md#class-websocketserver
     */
    this.wsServer = new WebSocketServer({
      server: HTTP_SERVER.httpServer,
      path: '/ws'
    })

    let sttState = 'disabled'
    let ttsState = 'disabled'

    if (HAS_STT) {
      sttState = 'enabled'

      await STT.init()
    }
    if (HAS_TTS) {
      ttsState = 'enabled'

      await TTS.init(LangHelper.getShortCode(LANG))
    }

    LogHelper.title('Initialization')
    LogHelper.success(`STT ${sttState}`)
    LogHelper.success(`TTS ${ttsState}`)

    try {
      await MODEL_LOADER.loadNLPModels()
    } catch (e) {
      LogHelper.error(`Failed to load NLP models: ${e}`)
    }

    this.wsServer.on('connection', (socket) => {
      LogHelper.title('Client')
      LogHelper.success('Connected')

      /**
       * @see https://github.com/websockets/ws/blob/HEAD/doc/ws.md#class-websocket
       */
      this.socket = socket

      // Check whether the TCP client is connected to the TCP server
      if (TCP_CLIENT.isConnected) {
        this.sendSocketMessage('ready')
      } else {
        TCP_CLIENT.ee.on('connected', () => {
          this.sendSocketMessage('ready')
        })
      }

      this.socket.on('message', (socketMessage: Buffer) => {
        try {
          const message = JSON.parse(socketMessage.toString())

          /**
           * Listen for socket messages
           */
          this.onHotwordDetectedMessage(message)
          this.onUtteranceMessage(message)
          this.onRecognizeMessage(message)
        } catch (e) {
          LogHelper.error(
            `Failed to process socket message as it does not respect the format: ${e}`
          )
        }
      })

      this.socket?.once('close', () => {
        LogHelper.title('Client')
        LogHelper.success('Disconnected')
        // TODO
        // deleteProvider(this.socket.id)
      })
    })
  }
}
