import fs from 'node:fs'

import type { LongLanguageCode } from '@/types'
import type { SynthesizeResult } from '@/core/tts/types'
import { HAS_ASR, LANG } from '@/constants'
import { PYTHON_TCP_CLIENT, SOCKET_SERVER, TTS } from '@/core'
import { TTSSynthesizerBase } from '@/core/tts/tts-synthesizer-base'
import { LogHelper } from '@/helpers/log-helper'

interface ChunkData {
  outputPath: string
  audioId: string
}

export default class LocalSynthesizer extends TTSSynthesizerBase {
  protected readonly name = 'Local TTS Synthesizer'
  protected readonly lang = LANG as LongLanguageCode

  constructor(lang: LongLanguageCode) {
    super()

    LogHelper.title(this.name)
    LogHelper.success('New instance')

    try {
      this.lang = lang

      LogHelper.success('Synthesizer initialized')
    } catch (e) {
      LogHelper.error(`${this.name} - Failed to initialize: ${e}`)
    }
  }

  public async synthesize(speech: string): Promise<SynthesizeResult | null> {
    const eventName = 'tts-audio-streaming'
    const eventHasListeners = PYTHON_TCP_CLIENT.ee.listenerCount(eventName) > 0

    if (!eventHasListeners) {
      PYTHON_TCP_CLIENT.ee.on(eventName, (data: ChunkData) => {
        /**
         * Send audio stream chunk by chunk to the client as long as
         * the temporary file is being written from the TCP server
         */
        const { outputPath, audioId } = data
        const stream = fs.createReadStream(outputPath)
        const chunks: Buffer[] = []
        stream.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
          // SOCKET_SERVER.socket?.emit('tts-stream', { chunk, audioId })
        })
        stream.on('end', async () => {
          const completeStream = Buffer.concat(chunks)

          SOCKET_SERVER.socket?.emit('tts-stream', {
            chunk: completeStream,
            audioId
          })

          try {
            const duration = await this.getAudioDuration(outputPath)
            TTS.em.emit('saved', duration)

            /**
             * Emit an event to the Python TCP server to indicate that the audio has ended.
             * Useful for ASR to start listening again after the audio has ended
             */
            if (HAS_ASR) {
              PYTHON_TCP_CLIENT.emit(
                'leon-speech-audio-ended',
                duration / 1_000 || 500
              )
              setTimeout(() => {
                SOCKET_SERVER.socket?.emit('tts-end-of-speech')
              }, duration)
            }
          } catch (e) {
            LogHelper.title(this.name)
            LogHelper.warning(`Failed to get audio duration: ${e}`)
          }
          try {
            fs.unlinkSync(outputPath)
          } catch (e) {
            LogHelper.warning(`Failed to delete tmp audio file: ${e}`)
          }
        })
      })
    }

    // TODO: support mood to control speed and pitch
    PYTHON_TCP_CLIENT.emit('tts-synthesize', speech)

    return {
      audioFilePath: '',
      duration: 500
    }
  }
}
