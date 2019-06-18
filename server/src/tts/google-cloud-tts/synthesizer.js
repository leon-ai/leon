'use strict'

import tts from '@google-cloud/text-to-speech'
import Ffmpeg from 'fluent-ffmpeg'
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg'
import { path as ffprobePath } from '@ffprobe-installer/ffprobe'
import fs from 'fs'

import log from '@/helpers/log'
import string from '@/helpers/string'

log.title('Google Cloud TTS Synthesizer')

const synthesizer = { }
const voices = {
  'en-US': {
    languageCode: 'en-US',
    name: 'en-US-Wavenet-A',
    // name: 'en-GB-Standard-B', // Standard
    ssmlGender: 'MALE'
  },
  'fr-FR': {
    languageCode: 'fr-FR',
    name: 'fr-FR-Wavenet-B',
    ssmlGender: 'MALE'
  }
}
let client = { }

synthesizer.conf = {
  voice: voices[process.env.LEON_LANG],
  audioConfig: {
    audioEncoding: 'MP3'
  }
}

/**
 * Initialize Google Cloud Text-to-Speech based on credentials in the JSON file
 * The env variable "GOOGLE_APPLICATION_CREDENTIALS" provides the JSON file path
 */
synthesizer.init = () => {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = `${__dirname}/../../config/voice/google-cloud.json`

  try {
    client = new tts.TextToSpeechClient()

    log.success('Synthesizer initialized')
  } catch (e) {
    log.error(`Google Cloud TTS: ${e}`)
  }
}

/**
 * Save string to audio file
 */
synthesizer.save = (speech, em, cb) => {
  const file = `${__dirname}/../../tmp/${Date.now()}-${string.random(4)}.mp3`

  synthesizer.conf.input = { text: speech }

  client.synthesizeSpeech(synthesizer.conf, (err, res) => {
    if (err) {
      log.error(`Google Cloud TTS: ${err}`)
      return
    }

    fs.writeFile(file, res.audioContent, 'binary', (err) => {
      if (err) {
        log.error(`Google Cloud TTS: ${err}`)
        return
      }

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
  })
}

export default synthesizer
