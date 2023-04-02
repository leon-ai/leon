// TODO: remove ignore
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck

import type { Socket } from 'node:net'

import { Server as SocketIOServer } from 'socket.io'

import { LANG, HAS_STT, HAS_TTS, IS_DEVELOPMENT_ENV } from '@/constants'
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

export default class SocketServer {
  private static instance: SocketServer

  public socket: Socket

  constructor() {
    if (!SocketServer.instance) {
      LogHelper.title('Socket Server')
      LogHelper.success('New instance')

      SocketServer.instance = this
    }
  }

  public async init(): void {
    const io = IS_DEVELOPMENT_ENV
      ? new SocketIOServer(HTTP_SERVER.httpServer, {
          cors: { origin: `${HTTP_SERVER.host}:3000` }
        })
      : new SocketIOServer(HTTP_SERVER.httpServer)

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

    io.on('connection', (socket) => {
      LogHelper.title('Client')
      LogHelper.success('Connected')

      this.socket = socket

      // Init
      this.socket.on('init', (data) => {
        LogHelper.info(`Type: ${data}`)
        LogHelper.info(`Socket ID: ${this.socket.id}`)

        // TODO
        // const provider = await addProvider(socket.id)

        // Check whether the TCP client is connected to the TCP server
        if (TCP_CLIENT.isConnected) {
          this.socket.emit('ready')
        } else {
          TCP_CLIENT.ee.on('connected', () => {
            this.socket.emit('ready')
          })
        }

        if (data === 'hotword-node') {
          // Hotword triggered
          this.socket.on('hotword-detected', (data) => {
            LogHelper.title('Socket')
            LogHelper.success(`Hotword ${data.hotword} detected`)

            this.socket.broadcast.emit('enable-record')
          })
        } else {
          // Listen for new utterance
          this.socket.on('utterance', async (data) => {
            LogHelper.title('Socket')
            LogHelper.info(`${data.client} emitted: ${data.value}`)

            this.socket.emit('is-typing', true)

            const { value: utterance } = data
            try {
              LogHelper.time('Utterance processed in')

              BRAIN.isMuted = false
              await NLU.process(utterance)

              LogHelper.title('Execution Time')
              LogHelper.timeEnd('Utterance processed in')
            } catch (e) {
              /* */
            }
          })

          // Handle automatic speech recognition
          this.socket.on('recognize', async (data: Buffer) => {
            try {
              await ASR.encode(data)
            } catch (e) {
              LogHelper.error(
                `ASR - Failed to encode audio blob to WAVE file: ${e.stack}`
              )
            }
          })
        }
      })

      this.socket.once('disconnect', () => {
        // TODO
        // deleteProvider(this.socket.id)
      })
    })
  }
}
