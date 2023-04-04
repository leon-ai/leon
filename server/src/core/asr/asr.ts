import path from 'node:path'
import fs from 'node:fs'

import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg'
import ffmpeg from 'fluent-ffmpeg'

import { TMP_PATH } from '@/constants'
import { STT } from '@/core'
import { LogHelper } from '@/helpers/log-helper'

export default class ASR {
  private static instance: ASR

  public audioPaths = {
    webm: path.join(TMP_PATH, 'speech.webm'),
    wav: path.join(TMP_PATH, 'speech.wav')
  }

  constructor() {
    if (!ASR.instance) {
      LogHelper.title('ASR')
      LogHelper.success('New instance')

      ASR.instance = this
    }
  }

  /**
   * Encode audio blob to WAVE file
   * and forward the WAVE file to the STT parser
   */
  public encode(blob: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      LogHelper.title('ASR')

      fs.writeFile(
        this.audioPaths.webm,
        Buffer.from(blob),
        'binary',
        async (err) => {
          if (err) {
            reject(new Error(`${err}`))
            return
          }

          ffmpeg.setFfmpegPath(ffmpegPath)

          /**
           * Encode WebM file to WAVE file
           * ffmpeg -i speech.webm -acodec pcm_s16le -ar 16000 -ac 1 speech.wav
           */
          ffmpeg()
            .addInput(this.audioPaths.webm)
            .on('start', () => {
              LogHelper.info('Encoding WebM file to WAVE file...')
            })
            .on('end', () => {
              LogHelper.success('Encoding done')

              if (!STT.isParserReady) {
                reject(new Error('The speech recognition is not ready yet'))
              } else {
                STT.transcribe(this.audioPaths.wav)
                resolve()
              }
            })
            .on('error', (err) => {
              reject(new Error(`Encoding error ${err}`))
            })
            .outputOptions(['-acodec pcm_s16le', '-ar 16000', '-ac 1'])
            .output(this.audioPaths.wav)
            .run()
        }
      )
    })
  }
}
