import Tts from 'ibm-watson/text-to-speech/v1'
import { IamAuthenticator } from 'ibm-watson/auth'
import Ffmpeg from 'fluent-ffmpeg'
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg'
import { path as ffprobePath } from '@ffprobe-installer/ffprobe'
import fs from 'fs'
import path from 'path'

import log from '@/helpers/log'
import string from '@/helpers/string'

log.title('Watson TTS Synthesizer')

const synthesizer = { }
const voices = {
  'en-US': {
    voice: 'en-US_MichaelV3Voice'
  },
  'fr-FR': {
    voice: 'fr-FR_NicolasV3Voice'
  }
}
let client = { }

synthesizer.conf = {
  voice: '',
  accept: 'audio/wav'
}

/**
 * Initialize Watson Text-to-Speech based on credentials in the JSON file
 */
synthesizer.init = (lang) => {
  const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'core/config/voice/watson-tts.json'), 'utf8'))
  synthesizer.conf.voice = voices[lang].voice

  try {
    client = new Tts({
      authenticator: new IamAuthenticator({ apikey: config.apikey }),
      serviceUrl: config.url
    })

    log.success('Synthesizer initialized')
  } catch (e) {
    log.error(`Watson TTS: ${e}`)
  }
}

/**
 * Save string to audio file
 */
synthesizer.save = (speech, em, cb) => {
  const file = `${__dirname}/../../tmp/${Date.now()}-${string.random(4)}.wav`

  synthesizer.conf.text = speech

  client.synthesize(synthesizer.conf)
    .then(({ result }) => {
      const wStream = fs.createWriteStream(file)

      result.pipe(wStream)

      wStream.on('finish', () => {
        const ffmpeg = new Ffmpeg()
        ffmpeg.setFfmpegPath(ffmpegPath)
        ffmpeg.setFfprobePath(ffprobePath)

        // Get file duration thanks to ffprobe
        ffmpeg.input(file).ffprobe((err, data) => {
          if (err) log.error(err)
          else {
            const duration = data.streams[0].duration * 1000
            em.emit('saved', duration)
            cb(file, duration)
          }
        })
      })

      wStream.on('error', (err) => {
        log.error(`Watson TTS: ${err}`)
      })
    })
    .catch((err) => {
      log.error(`Watson TTS: ${err}`)
    })
}

export default synthesizer
