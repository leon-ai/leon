import path from 'node:path'
import fs from 'node:fs'

import Tts from 'ibm-watson/text-to-speech/v1'
import { IamAuthenticator } from 'ibm-watson/auth'

import type { WatsonVoiceConfiguration } from '@/schemas/voice-config-schemas'
import type { LongLanguageCode } from '@/types'
import type { SynthesizeResult } from '@/core/tts/types'
import { LANG, VOICE_CONFIG_PATH, TMP_PATH } from '@/constants'
import { TTS } from '@/core'
import { TTSSynthesizerBase } from '@/core/tts/tts-synthesizer-base'
import { LogHelper } from '@/helpers/log-helper'
import { StringHelper } from '@/helpers/string-helper'

const VOICES = {
  'en-US': {
    voice: 'en-US_MichaelV3Voice'
  },
  'fr-FR': {
    voice: 'fr-FR_NicolasV3Voice'
  }
}

export class WatsonTTSSynthesizer extends TTSSynthesizerBase {
  protected readonly name = 'Watson TTS Synthesizer'
  protected readonly lang: LongLanguageCode = LANG as LongLanguageCode
  private readonly client: Tts | undefined = undefined

  constructor(lang: LongLanguageCode) {
    super()

    LogHelper.title(this.name)
    LogHelper.success('New instance')

    const config: WatsonVoiceConfiguration = JSON.parse(
      fs.readFileSync(path.join(VOICE_CONFIG_PATH, 'watson-stt.json'), 'utf8')
    )

    try {
      this.lang = lang
      this.client = new Tts({
        authenticator: new IamAuthenticator({ apikey: config.apikey }),
        serviceUrl: config.url
      })

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
        const { result } = await this.client.synthesize({
          voice: VOICES[this.lang].voice,
          text: speech,
          accept: 'audio/wav'
        })

        const wStream = fs.createWriteStream(audioFilePath)
        result.pipe(wStream)

        await new Promise((resolve, reject) => {
          wStream.on('finish', resolve)
          wStream.on('error', reject)
        })

        const duration = await this.getAudioDuration(audioFilePath)

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
