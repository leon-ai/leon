import { execa } from 'execa'
import { path as ffprobePath } from '@ffprobe-installer/ffprobe'

import type { LongLanguageCode } from '@/types'
import type { SynthesizeResult } from '@/core/tts/types'
import { LogHelper } from '@/helpers/log-helper'

export abstract class TTSSynthesizerBase {
  protected abstract name: string
  protected abstract lang: LongLanguageCode

  protected abstract synthesize(
    speech: string
  ): Promise<SynthesizeResult | null>

  protected async getAudioDuration(audioFilePath: string): Promise<number> {
    try {
      const { stdout } = await execa(ffprobePath, [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'json',
        '-i', audioFilePath
      ])
      const metadata = JSON.parse(stdout) as {
        format?: { duration?: string | number }
      }
      const duration = Number(metadata.format?.duration)

      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error('Audio duration is undefined or invalid')
      }

      return duration * 1_000
    } catch (err) {
      LogHelper.error(`${this.name} - Failed to get audio duration: ${err}`)

      throw 0
    }
  }
}
