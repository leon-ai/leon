import path from 'node:path'
import fs from 'node:fs'

import type { LongLanguageCode } from '@/types'
import type { SynthesizeResult } from '@/core/tts/types'
import { LANG, TMP_PATH } from '@/constants'
import { TTS } from '@/core'
import { TTSSynthesizerBase } from '@/core/tts/tts-synthesizer-base'
import { LogHelper } from '@/helpers/log-helper'
import { StringHelper } from '@/helpers/string-helper'

const LANGUAGE_MAP: Record<string, string> = {
  'en-US': 'en-us',
  'fr-FR': 'fr-fr',
  'es-ES': 'es-es',
  'de-DE': 'de-de',
  'it-IT': 'it-it',
  'pt-BR': 'pt-br',
  'pt-PT': 'pt-pt',
  'ja-JP': 'ja-jp',
  'ko-KR': 'ko-kr',
  'zh-CN': 'zh-cn',
  'zh-TW': 'zh-tw',
  'ar-SA': 'ar-sa',
  'hi-IN': 'hi-in',
  'ru-RU': 'ru-ru',
  'nl-NL': 'nl-nl',
  'pl-PL': 'pl-pl',
  'tr-TR': 'tr-tr',
  'vi-VN': 'vi-vn',
  'th-TH': 'th-th',
  'sv-SE': 'sv-se'
}

export default class CambAISynthesizer extends TTSSynthesizerBase {
  protected readonly name = 'CAMB AI Synthesizer'
  protected readonly lang = LANG as LongLanguageCode
  private readonly apiKey: string | undefined

  constructor(lang: LongLanguageCode) {
    super()

    LogHelper.title(this.name)
    LogHelper.success('New instance')

    try {
      this.lang = lang
      this.apiKey = process.env['CAMB_AI_API_KEY']

      if (!this.apiKey) {
        LogHelper.error(
          `${this.name}: CAMB_AI_API_KEY environment variable is not set`
        )
      }

      LogHelper.success('Synthesizer initialized')
    } catch (e) {
      LogHelper.error(`${this.name}: ${e}`)
    }
  }

  public async synthesize(speech: string): Promise<SynthesizeResult | null> {
    const audioFilePath = path.join(
      TMP_PATH,
      `${Date.now()}-${StringHelper.random(4)}.wav`
    )

    try {
      if (!this.apiKey) {
        LogHelper.error(`${this.name} - CAMB_AI_API_KEY is not set`)
        return null
      }

      const language =
        LANGUAGE_MAP[this.lang] || this.lang.toLowerCase()

      const voiceId = process.env['CAMB_AI_VOICE_ID']
        ? Number(process.env['CAMB_AI_VOICE_ID'])
        : 147320

      const body = JSON.stringify({
        text: speech,
        voice_id: voiceId,
        language,
        speech_model: process.env['CAMB_AI_TTS_MODEL'] || 'mars-flash',
        output_configuration: { format: 'wav' }
      })

      const response = await fetch(
        'https://client.camb.ai/apis/tts-stream',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey
          },
          body
        }
      )

      if (!response.ok) {
        throw new Error(
          `CAMB AI TTS request failed with status ${response.status}: ${response.statusText}`
        )
      }

      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      await fs.promises.writeFile(audioFilePath, buffer)

      const duration = await this.getAudioDuration(audioFilePath)

      TTS.em.emit('saved', duration)

      return {
        audioFilePath,
        duration
      }
    } catch (e) {
      LogHelper.error(`${this.name} - Failed to synthesize speech: ${e}`)
    }

    return null
  }
}
