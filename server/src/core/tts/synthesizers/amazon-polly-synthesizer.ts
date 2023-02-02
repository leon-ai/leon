import type { Stream } from 'node:stream'
import path from 'node:path'
import fs from 'node:fs'

import Ffmpeg from 'fluent-ffmpeg'
import { Polly, SynthesizeSpeechCommand } from '@aws-sdk/client-polly'
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg'
import { path as ffprobePath } from '@ffprobe-installer/ffprobe'

import type { LongLanguageCode } from '@/types'
import type { TTSSynthesizerFacade, SynthesizeResult } from '@/core/tts/types'
import type { AmazonVoiceConfiguration } from '@/schemas/voice-config-schemas'
import { LANG, VOICE_CONFIG_PATH, TMP_PATH } from '@/constants'
import { TTS } from '@/core'
import { LogHelper } from '@/helpers/log-helper'
import { StringHelper } from '@/helpers/string-helper'

const VOICES = {
  'en-US': {
    VoiceId: 'Matthew'
  },
  'fr-FR': {
    VoiceId: 'Mathieu'
  }
}

export class AmazonPollyTTSSynthesizer implements TTSSynthesizerFacade {
  private readonly name = 'Amazon Polly TTS Synthesizer'
  private readonly client: Polly | undefined = undefined
  private readonly lang: LongLanguageCode = LANG as LongLanguageCode

  constructor(lang: LongLanguageCode) {
    LogHelper.title(this.name)
    LogHelper.success('New instance')

    const config: AmazonVoiceConfiguration = JSON.parse(
      fs.readFileSync(path.join(VOICE_CONFIG_PATH, 'amazon.json'), 'utf8')
    )

    try {
      this.lang = lang
      this.client = new Polly(config)

      LogHelper.success('Synthesizer initialized')
    } catch (e) {
      LogHelper.error(`${this.name}: ${e}`)
    }
  }

  public async synthesize(speech: string): Promise<SynthesizeResult | null> {
    const audioFilePath = path.join(
      TMP_PATH,
      `${Date.now()}-${StringHelper.random(4)}.mp3`
    )

    try {
      if (this.client) {
        const result = await this.client.send(
          new SynthesizeSpeechCommand({
            OutputFormat: 'mp3',
            VoiceId: VOICES[this.lang].VoiceId,
            Text: speech
          })
        )
        // Cast to Node.js stream as the SDK returns a custom type that does not have a pipe method
        const AudioStream = result.AudioStream as Stream

        if (!AudioStream) {
          LogHelper.error(`${this.name}: AudioStream is undefined`)

          return null
        }

        const wStream = fs.createWriteStream(audioFilePath)
        AudioStream.pipe(wStream)

        await new Promise((resolve, reject) => {
          wStream.on('finish', resolve)
          wStream.on('error', reject)
        })

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ffmpeg = new (Ffmpeg as any)()
        ffmpeg.setFfmpegPath(ffmpegPath)
        ffmpeg.setFfprobePath(ffprobePath)

        const data = await ffmpeg.input(audioFilePath).ffprobe()
        const duration = data.streams[0].duration * 1_000

        TTS.em.emit('saved', duration)

        return {
          audioFilePath,
          duration
        }
      }

      LogHelper.error(`${this.name}: client is not defined yet`)
    } catch (e) {
      LogHelper.error(`${this.name}: Failed to synthesize speech: ${e} `)
    }

    return null
  }
}
