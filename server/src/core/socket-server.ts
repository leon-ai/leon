// TODO: remove ignore
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck

import type { Socket } from 'node:net'

import { Server as SocketIOServer } from 'socket.io'

import {
  HAS_STT,
  HAS_TTS,
  IS_DEVELOPMENT_ENV,
  STT_PROVIDER,
  TTS_PROVIDER
} from '@/constants'
import { HTTP_SERVER, TCP_CLIENT, ASR, STT, TTS } from '@/core'
import { LogHelper } from '@/helpers/log-helper'
import Asr from '@/core/asr/asr'
// import Stt from '@/stt/stt'
// import Tts from '@/tts/tts'

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

  public init(): void {
    const { httpServer, host } = HTTP_SERVER
    const io = IS_DEVELOPMENT_ENV
      ? new SocketIOServer(httpServer, {
          cors: { origin: `${host}:3000` }
        })
      : new SocketIOServer(httpServer)

    io.on('connection', (socket) => {
      LogHelper.title('Client')
      LogHelper.success('Connected')

      this.socket = socket

      // Init
      this.socket.on('init', async (data) => {
        LogHelper.info(`Type: ${data}`)
        LogHelper.info(`Socket id: ${this.socket.id}`)

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
          let sttState = 'disabled'
          let ttsState = 'disabled'

          // TODO
          // provider.brain.socket = socket

          if (HAS_STT) {
            sttState = 'enabled'

            // TODO
            // provider.brain.stt = new Stt(socket, STT_PROVIDER)
            // provider.brain.stt.init(() => null)
            await STT.init()
          }
          if (HAS_TTS) {
            ttsState = 'enabled'

            // TODO
            // provider.brain.tts = new Tts(socket, TTS_PROVIDER)
            // provider.brain.tts.init('en', () => null)
            await TTS.init()
          }

          LogHelper.title('Initialization')
          LogHelper.success(`STT ${sttState}`)
          LogHelper.success(`TTS ${ttsState}`)

          // Listen for new utterance
          this.socket.on('utterance', async (data) => {
            LogHelper.title('Socket')
            LogHelper.info(`${data.client} emitted: ${data.value}`)

            this.socket.emit('is-typing', true)

            // TODO
            // const utterance = data.value
            try {
              LogHelper.time('Utterance processed in')
              // TODO
              // await provider.nlu.process(utterance)
              LogHelper.title('Execution Time')
              LogHelper.timeEnd('Utterance processed in')
            } catch (e) {
              /* */
            }
          })

          // Handle automatic speech recognition
          this.socket.on('recognize', async (data) => {
            try {
              await ASR.encode(data)
            } catch (e) {
              LogHelper[e.type](e.obj.message)
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
