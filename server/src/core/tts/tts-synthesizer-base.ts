import ffmpeg from 'fluent-ffmpeg'
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg'
import { path as ffprobePath } from '@ffprobe-installer/ffprobe'

import type { LongLanguageCode } from '@/types'
import type { SynthesizeResult } from '@/core/tts/types'
import { LogHelper } from '@/helpers/log-helper'

export abstract class TTSSynthesizerBase {
  protected abstract name: string
  protected abstract lang: LongLanguageCode

  protected abstract synthesize(speech: string): Promise<SynthesizeResult | null>

  protected async getAudioDuration(audioFilePath: string): Promise<number> {
    ffmpeg.setFfmpegPath(ffmpegPath)
    ffmpeg.setFfprobePath(ffprobePath)

    // Use ffprobe to get the duration of the audio file and return the duration in milliseconds
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(audioFilePath, (err, data) => {
        if (err) {
          LogHelper.error(`${this.name} - Failed to get audio duration: ${err}`)

          return reject(0)
        }

        const { duration } = data.format

        if (!duration) {
          LogHelper.error(`${this.name} - Audio duration is undefined`)

          return reject(0)
        }

        return resolve(duration * 1_000)
      })
    })
  }
}
