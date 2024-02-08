import path from 'node:path'
import fs from 'node:fs'

import type { TextToSpeechClient } from '@google-cloud/text-to-speech'
import gTTS from '@google-cloud/text-to-speech'
import { google } from '@google-cloud/text-to-speech/build/protos/protos'

import type { LongLanguageCode } from '@/types'
import TextToSpeech from '@/core/tts/tts'
import type { SynthesizeResult } from '@/core/tts/types'
import { LANG, VOICE_CONFIG_PATH, TMP_PATH } from '@/constants'
import { TTSSynthesizerBase } from '@/core/tts/tts-synthesizer-base'
import { LogHelper } from '@/helpers/log-helper'
import { StringHelper } from '@/helpers/string-helper'

import SsmlVoiceGender = google.cloud.texttospeech.v1.SsmlVoiceGender

const VOICES = {
  'en-US': {
    languageCode: 'en-US',
    name: 'en-US-Wavenet-A',
    // name: 'en-GB-Standard-B', // Standard
    ssmlGender: SsmlVoiceGender.MALE
  },
  'fr-FR': {
    languageCode: 'fr-FR',
    name: 'fr-FR-Wavenet-B',
    ssmlGender: SsmlVoiceGender.MALE
  }
}

export default class GoogleCloudTTSSynthesizer extends TTSSynthesizerBase {
  protected readonly name = 'Google Cloud TTS Synthesizer'
  protected readonly lang = LANG as LongLanguageCode
  private readonly client: TextToSpeechClient | undefined = undefined

  private _tts: TextToSpeech
  public get tts(): TextToSpeech {
    return this._tts
  }
  constructor(tts: TextToSpeech, lang: LongLanguageCode) {
    super()

    LogHelper.title(this.name)
    LogHelper.success('New instance')

    process.env['GOOGLE_APPLICATION_CREDENTIALS'] = path.join(
      VOICE_CONFIG_PATH,
      'google-cloud.json'
    )

    this._tts = tts

    try {
      this.lang = lang
      this.client = new gTTS.TextToSpeechClient()

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
        const [response] = await this.client.synthesizeSpeech({
          input: {
            text: speech
          },
          voice: VOICES[this.lang],
          audioConfig: {
            audioEncoding: 'MP3'
          }
        })

        await fs.promises.writeFile(
          audioFilePath,
          response.audioContent as Uint8Array | string,
          'binary'
        )

        const duration = await this.getAudioDuration(audioFilePath)

        this.tts.em.emit('saved', duration)

        return {
          audioFilePath,
          duration
        }
      }

      LogHelper.error(`${this.name} - client is not defined yet`)
    } catch (e) {
      LogHelper.error(`${this.name} - Failed to synthesize speech: ${e} `)
    }

    return null
  }
}
