'use strict'

import Tts from 'ibm-watson/text-to-speech/v1'
import Ffmpeg from 'fluent-ffmpeg'
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg'
import { path as ffprobePath } from '@ffprobe-installer/ffprobe'
import fs from 'fs'

import log from '@/helpers/log'
import string from '@/helpers/string'

log.title('Watson TTS Synthesizer')

const synthesizer = { }
const voices = {
  'en-US': {
    voice: 'en-US_MichaelVoice'
  },
  'fr-FR': {
    voice: 'en-US_MichaelVoice' // fr-FR (male) not yet implemented
    // voice: 'fr-FR_ReneeVoice' // French female voice
  }
}
let client = { }

synthesizer.conf = {
  voice: voices[process.env.LEON_LANG].voice,
  accept: 'audio/wav'
}

/**
 * Initialize Watson Text-to-Speech based on credentials in the JSON file
 */
synthesizer.init = () => {
  const credentials = JSON.parse(fs.readFileSync(`${__dirname}/../../config/voice/watson-tts.json`, 'utf8'))

  try {
    if (process.env.LEON_LANG === 'fr-FR') {
      log.warning('fr-FR (male) is not yet implemented for the Watson TTS synthesizer')
    }

    client = new Tts(credentials)

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

  client.synthesize(synthesizer.conf, (err, result) => {
    if (err) {
      log.error(`Watson TTS: ${err}`)
      return
    }

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
          em.emit('saved', data.streams[0].duration * 1000)
          cb(file)
        }
      })
    })

    wStream.on('error', (err) => {
      log.error(`Watson TTS: ${err}`)
    })
  })
}

export default synthesizer
