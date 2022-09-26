import fs from 'node:fs'
import path from 'node:path'

import { IS_TESTING_ENV } from '@/constants'
import Asr from '@/core/asr'
import { LogHelper } from '@/helpers/log-helper'

class Stt {
  constructor(socket, provider) {
    this.socket = socket
    this.provider = provider
    this.providers = ['google-cloud-stt', 'watson-stt', 'coqui-stt']
    this.parser = {}

    LogHelper.title('STT')
    LogHelper.success('New instance')
  }

  /**
   * Initialize the STT provider
   */
  init(cb) {
    LogHelper.info('Initializing STT...')

    if (!this.providers.includes(this.provider)) {
      LogHelper.error(
        `The STT provider "${this.provider}" does not exist or is not yet supported`
      )

      return false
    }

    /* istanbul ignore next */
    if (
      this.provider === 'google-cloud-stt' &&
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
      LogHelper.warning(
        `The "GOOGLE_APPLICATION_CREDENTIALS" env variable is already settled with the following value: "${process.env.GOOGLE_APPLICATION_CREDENTIALS}"`
      )
    }

    /* istanbul ignore if */
    if (!IS_TESTING_ENV) {
      // Dynamically attribute the parser
      this.parser = require(`${__dirname}/${this.provider}/parser`)
      this.parser.default.init(this.parser.default.conf)
    }

    LogHelper.title('STT')
    LogHelper.success('STT initialized')

    cb(this)

    return true
  }

  /**
   * Forward string output to the client
   * and delete audio files once it has been forwarded
   */
  forward(string) {
    this.socket.emit('recognized', string, (confirmation) => {
      /* istanbul ignore next */
      if (confirmation === 'string-received') {
        Stt.deleteAudios()
      }
    })

    LogHelper.success(`Parsing result: ${string}`)
  }

  /**
   * Read the speech file and parse
   */
  parse(file) {
    LogHelper.info('Parsing WAVE file...')

    if (!fs.existsSync(file)) {
      LogHelper.error(`The WAVE file "${file}" does not exist`)

      return false
    }

    const buffer = fs.readFileSync(file)
    /* istanbul ignore if */
    if (!IS_TESTING_ENV) {
      this.parser.default.parse(buffer, (data) => {
        if (data.string !== '') {
          // Forward the string to the client
          this.forward(data.string)
        } else {
          Stt.deleteAudios()
        }
      })
    }

    return true
  }

  /**
   * Delete audio files
   */
  static deleteAudios() {
    return new Promise((resolve) => {
      const audios = Object.keys(Asr.audios)

      for (let i = 0; i < audios.length; i += 1) {
        const audio = Asr.audios[audios[i]]

        if (fs.existsSync(audio)) {
          fs.unlinkSync(Asr.audios[audios[i]])
        }

        if (i + 1 === audios.length) {
          resolve()
        }
      }
    })
  }
}

export default Stt
