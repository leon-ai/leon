import path from 'node:path'
import events from 'node:events'
import fs from 'node:fs'

import type { ShortLanguageCode } from '@/types'
import type { TTSSynthesizer } from '@/core/tts/types'
import { SOCKET_SERVER } from '@/core'
import { TTS_PROVIDER, VOICE_CONFIG_PATH } from '@/constants'
import { TTSSynthesizers, TTSProviders } from '@/core/tts/types'
import { LogHelper } from '@/helpers/log-helper'
import { LangHelper } from '@/helpers/lang-helper'

type Speech = {
  text: string
  isFinalAnswer: boolean
}

export default class TTS {
  private static instance: TTS

  private synthesizer: TTSSynthesizer = undefined
  private speeches: Speech[] = []

  public lang: ShortLanguageCode = 'en'
  public em = new events.EventEmitter()

  constructor() {
    if (!TTS.instance) {
      LogHelper.title('TTS')
      LogHelper.success('New instance')

      TTS.instance = this
    }
  }

  /**
   * Initialize the TTS provider
   */
  public async init(newLang: ShortLanguageCode): Promise<boolean> {
    LogHelper.info('Initializing TTS...')

    this.lang = newLang || this.lang

    if (!Object.values(TTSProviders).includes(TTS_PROVIDER as TTSProviders)) {
      LogHelper.error(
        `The TTS provider "${TTS_PROVIDER}" does not exist or is not yet supported`
      )

      return false
    }

    if (
      TTS_PROVIDER === TTSProviders.GoogleCloudTTS &&
      typeof process.env['GOOGLE_APPLICATION_CREDENTIALS'] === 'undefined'
    ) {
      process.env['GOOGLE_APPLICATION_CREDENTIALS'] = path.join(
        VOICE_CONFIG_PATH,
        'google-cloud.json'
      )
    } else if (
      typeof process.env['GOOGLE_APPLICATION_CREDENTIALS'] !== 'undefined' &&
      process.env['GOOGLE_APPLICATION_CREDENTIALS'].indexOf(
        'google-cloud.json'
      ) === -1
    ) {
      LogHelper.warning(
        `The "GOOGLE_APPLICATION_CREDENTIALS" env variable is already settled with the following value: "${process.env['GOOGLE_APPLICATION_CREDENTIALS']}"`
      )
    }

    // Dynamically attribute the synthesizer
    const synthesizer = await import(
      path.join(
        __dirname,
        'synthesizers',
        TTSSynthesizers[TTS_PROVIDER as keyof typeof TTSSynthesizers]
      )
    )
    this.synthesizer = new synthesizer(
      LangHelper.getLongCode(this.lang)
    ) as TTSSynthesizer

    this.onSaved()

    LogHelper.title('TTS')
    LogHelper.success('TTS initialized')

    return true
  }

  /**
   * Forward buffer audio file and duration to the client
   * and delete audio file once it has been forwarded
   */
  private async forward(speech: Speech): Promise<void> {
    if (this.synthesizer) {
      const result = await this.synthesizer.synthesize(speech.text)

      if (!result) {
        LogHelper.error(
          'The TTS synthesizer failed to synthesize the speech as the result is null'
        )
      } else {
        const { audioFilePath, duration } = result
        const bitmap = fs.readFileSync(audioFilePath)

        SOCKET_SERVER.socket.emit(
          'audio-forwarded',
          {
            buffer: Buffer.from(bitmap),
            is_final_answer: speech.isFinalAnswer,
            duration
          },
          (confirmation: string) => {
            if (confirmation === 'audio-received') {
              fs.unlinkSync(audioFilePath)
            }
          }
        )
      }
    } else {
      LogHelper.error('The TTS synthesizer is not initialized yet')
    }
  }

  /**
   * When the synthesizer saved a new audio file
   * then shift the queue according to the audio file duration
   */
  private onSaved(): void {
    this.em.on('saved', (duration) => {
      setTimeout(async () => {
        this.speeches.shift()

        if (this.speeches[0]) {
          await this.forward(this.speeches[0])
        }
      }, duration)
    })
  }

  /**
   * Add speeches to the queue
   */
  public async add(text: Speech['text'], isFinalAnswer: Speech['isFinalAnswer']): Promise<Speech[]> {
    /**
     * Flite fix. When the string is only one word,
     * Flite cannot save to a file. So we add a space at the end of the string
     */
    if (TTS_PROVIDER === TTSProviders.Flite && text.indexOf(' ') === -1) {
      text += ' '
    }

    const speech = { text, isFinalAnswer }

    if (this.speeches.length > 0) {
      this.speeches.push(speech)
    } else {
      this.speeches.push(speech)
      await this.forward(speech)
    }

    return this.speeches
  }
}
