import events from 'events'
import fs from 'fs'
import path from 'path'

import { LOG } from '@/helpers/log'
import { LangHelper } from '@/helpers/lang-helper'

class Tts {
  constructor(socket, provider) {
    this.socket = socket
    this.provider = provider
    this.providers = ['flite', 'google-cloud-tts', 'amazon-polly', 'watson-tts']
    this.synthesizer = {}
    this.em = new events.EventEmitter()
    this.speeches = []
    this.lang = 'en'

    LOG.title('TTS')
    LOG.success('New instance')
  }

  /**
   * Initialize the TTS provider
   */
  init(newLang, cb) {
    LOG.info('Initializing TTS...')

    this.lang = newLang || this.lang

    if (!this.providers.includes(this.provider)) {
      LOG.error(
        `The TTS provider "${this.provider}" does not exist or is not yet supported`
      )

      return false
    }

    /* istanbul ignore next */
    if (
      this.provider === 'google-cloud-tts' &&
      typeof process.env.GOOGLE_APPLICATION_CREDENTIALS === 'undefined'
    ) {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(
        process.cwd(),
        'core/config/voice/google-cloud.json'
      )
    } else if (
      typeof process.env.GOOGLE_APPLICATION_CREDENTIALS !== 'undefined' &&
      process.env.GOOGLE_APPLICATION_CREDENTIALS.indexOf(
        'google-cloud.json'
      ) === -1
    ) {
      LOG.warning(
        `The "GOOGLE_APPLICATION_CREDENTIALS" env variable is already settled with the following value: "${process.env.GOOGLE_APPLICATION_CREDENTIALS}"`
      )
    }

    // Dynamically attribute the synthesizer
    this.synthesizer = require(`${__dirname}/${this.provider}/synthesizer`)
    this.synthesizer.default.init(LangHelper.getLongCode(this.lang))

    this.onSaved()

    LOG.title('TTS')
    LOG.success('TTS initialized')

    cb(this)

    return true
  }

  /**
   * Forward buffer audio file and duration to the client
   * and delete audio file once it has been forwarded
   */
  forward(speech) {
    this.synthesizer.default.save(speech.text, this.em, (file, duration) => {
      /* istanbul ignore next */
      const bitmap = fs.readFileSync(file)
      /* istanbul ignore next */
      this.socket.emit(
        'audio-forwarded',
        {
          buffer: Buffer.from(bitmap),
          is_final_answer: speech.isFinalAnswer,
          duration
        },
        (confirmation) => {
          if (confirmation === 'audio-received') {
            fs.unlinkSync(file)
          }
        }
      )
    })
  }

  /**
   * When the synthesizer saved a new audio file
   * then shift the queue according to the audio file duration
   */
  onSaved() {
    return new Promise((resolve) => {
      this.em.on('saved', (duration) => {
        setTimeout(() => {
          this.speeches.shift()

          if (this.speeches[0]) {
            this.forward(this.speeches[0])
          }

          resolve()
        }, duration)
      })
    })
  }

  /**
   * Add speeches to the queue
   */
  add(text, isFinalAnswer) {
    /**
     * Flite fix. When the string is only one word,
     * Flite cannot save to a file. So we add a space at the end of the string
     */
    if (this.provider === 'flite' && text.indexOf(' ') === -1) {
      text += ' '
    }

    const speech = { text, isFinalAnswer }

    if (this.speeches.length > 0) {
      this.speeches.push(speech)
    } else {
      this.speeches.push(speech)
      this.forward(speech)
    }

    return this.speeches
  }
}

export default Tts
