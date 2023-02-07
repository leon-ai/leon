import Ffmpeg from 'fluent-ffmpeg'
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg'
import { path as ffprobePath } from '@ffprobe-installer/ffprobe'

export class TTSSynthesizerBase {
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
