import type { DefaultEventsMap } from 'socket.io/dist/typed-events'
import { Server as SocketIOServer, Socket } from 'socket.io'

import { LANG, HAS_STT, HAS_TTS, IS_DEVELOPMENT_ENV } from '@/constants'
import { HTTP_SERVER, TCP_CLIENT, ASR, STT, MODEL_LOADER } from '@/core'
import { LogHelper } from '@/helpers/log-helper'
import { LangHelper } from '@/helpers/lang-helper'
import { Telemetry } from '@/telemetry'
import TextToSpeech from '@/core/tts/tts'
import NaturalLanguageUnderstanding from '@/core/nlp/nlu/nlu'
import Brain from '@/core/brain/brain'

interface HotwordDataEvent {
  hotword: string
  buffer: Buffer
}

interface UtteranceDataEvent {
  client: string
  value: string
}

export type ClientSocket = Socket<DefaultEventsMap, DefaultEventsMap>

export default class SocketServer {
  private nlus: Map<string, NaturalLanguageUnderstanding> = new Map()
  private onConnectionReady!: (socket: ClientSocket) => void
  private onDisconnect!: (socket: ClientSocket) => void

  constructor() {
    LogHelper.title('Socket Server')
    LogHelper.success('New instance')
    ;(this.onConnectionReady = (socket): void => {
      const brain = new Brain(socket)
      const nlu = new NaturalLanguageUnderstanding(brain)
      let ttsState = 'disabled'
      this.nlus.set(socket.id, nlu)
      if (HAS_TTS) {
        this.getSocketTextToSpeech(socket.id)
          ?.init(LangHelper.getShortCode(LANG))
          ?.then(() => {
            ttsState = 'enabled'
            LogHelper.success(`TTS ${ttsState} for client ${socket.id}`)
          })
      }
    }),
      (this.onDisconnect = (socket): void => {
        const { id } = socket
        this.nlus.get(id)?.brain.dispose()
        this.nlus.delete(id)
      })
  }

  private getSocketNlu(
    socketId: string
  ): NaturalLanguageUnderstanding | undefined {
    return this.nlus.get(socketId)
  }
  private getSocketBrain(socketId: string): Brain | undefined {
    return this.getSocketNlu(socketId)?.brain
  }
  private getSocketTextToSpeech(socketId: string): TextToSpeech | undefined {
    return this.getSocketBrain(socketId)?.tts
  }

  public async init(): Promise<void> {
    const io = IS_DEVELOPMENT_ENV
      ? new SocketIOServer(HTTP_SERVER.httpServer, {
          cors: { origin: `${HTTP_SERVER.host}:3000` }
        })
      : new SocketIOServer(HTTP_SERVER.httpServer)

    let sttState = 'disabled'

    if (HAS_STT) {
      sttState = 'enabled'

      await STT.init()
    }

    LogHelper.title('Initialization')
    LogHelper.success(`STT ${sttState}`)

    try {
      await MODEL_LOADER.loadNLPModels()
    } catch (e) {
      LogHelper.error(`Failed to load NLP models: ${e}`)
    }

    io.on('connection', (socket) => {
      LogHelper.title('Client')
      LogHelper.success('Connected')

      // Init
      socket.on('init', (data: string) => {
        LogHelper.info(`Type: ${data}`)
        LogHelper.info(`Socket ID: ${socket.id}`)

        this.onConnectionReady(socket)

        // Check whether the TCP client is connected to the TCP server
        if (TCP_CLIENT.isConnected) {
          socket.emit('ready')
        } else {
          TCP_CLIENT.ee.on('connected', () => {
            socket.emit('ready')
          })
        }

        if (data === 'hotword-node') {
          // Hotword triggered
          socket.on('hotword-detected', (data: HotwordDataEvent) => {
            LogHelper.title('Socket')
            LogHelper.success(`Hotword ${data.hotword} detected`)

            socket.broadcast.emit('enable-record')
          })
        } else {
          // Listen for new utterance
          socket.on('utterance', async (data: UtteranceDataEvent) => {
            LogHelper.title('Socket')
            LogHelper.info(`${data.client} emitted: ${data.value}`)

            socket.emit('is-typing', true)

            const { value: utterance } = data
            try {
              LogHelper.time('Utterance processed in')

              const processedData = await this.getSocketNlu(socket.id)?.process(
                utterance
              )

              if (processedData) {
                Telemetry.utterance(processedData)
              }

              LogHelper.title('Execution Time')
              LogHelper.timeEnd('Utterance processed in')
            } catch (e) {
              LogHelper.error(`Failed to process utterance: ${e}`)
            }
          })

          // Handle automatic speech recognition
          socket.on('recognize', async (data: Buffer) => {
            try {
              await ASR.encode(data, socket)
            } catch (e) {
              LogHelper.error(
                `ASR - Failed to encode audio blob to WAVE file: ${e}`
              )
            }
          })
        }
      })

      socket.once('disconnect', () => {
        this.onDisconnect(socket)
      })
    })
  }
}
