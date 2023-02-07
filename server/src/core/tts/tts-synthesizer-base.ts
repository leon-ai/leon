import Ffmpeg from 'fluent-ffmpeg'
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg'
import { path as ffprobePath } from '@ffprobe-installer/ffprobe'

import type { LongLanguageCode } from '@/types'
import type { SynthesizeResult } from '@/core/tts/types'

export abstract class TTSSynthesizerBase {
  protected abstract name: string
  protected abstract lang: LongLanguageCode

  protected abstract synthesize(speech: string): Promise<SynthesizeResult | null>

  protected async getAudioDuration(audioFilePath: string): Promise<number> {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const ffmpeg = new Ffmpeg()
    ffmpeg.setFfmpegPath(ffmpegPath)
    ffmpeg.setFfprobePath(ffprobePath)

    const data = await ffmpeg.input(audioFilePath).ffprobe()

    return data.streams[0].duration * 1_000
  }
}
