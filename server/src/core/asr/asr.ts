import path from 'node:path'
import fs from 'node:fs'

import ffmpegStatic from 'ffmpeg-static'
import { execa } from 'execa'

import { TMP_PATH } from '@/constants'
import { ASR_ENGINE } from '@/core'
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
   * and forward the WAVE file to the ASR parser.
   */
  public async encode(blob: Buffer): Promise<void> {
    LogHelper.title('ASR')

    if (!ffmpegStatic) {
      throw new Error('FFmpeg binary is unavailable')
    }

    await fs.promises.writeFile(this.audioPaths.webm, blob)
    LogHelper.info('Encoding WebM file to WAVE file...')

    try {
      await execa(ffmpegStatic, [
        '-nostdin',
        '-y',
        '-i', this.audioPaths.webm,
        '-acodec', 'pcm_s16le',
        '-ar', '16000',
        '-ac', '1',
        this.audioPaths.wav
      ])
    } catch (err) {
      throw new Error(`Encoding error ${err}`)
    }

    LogHelper.success('Encoding done')

    if (!ASR_ENGINE.isParserReady) {
      throw new Error('The speech recognition is not ready yet')
    }

    ASR_ENGINE.transcribe(this.audioPaths.wav)
  }
}
