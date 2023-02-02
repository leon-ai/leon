import fs from 'node:fs'
import path from 'node:path'

import tts from '@google-cloud/text-to-speech'
import Ffmpeg from 'fluent-ffmpeg'
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg'
import { path as ffprobePath } from '@ffprobe-installer/ffprobe'

import { TMP_PATH } from '@/constants'
import { LogHelper } from '@/helpers/log-helper'
import { StringHelper } from '@/helpers/string-helper'

LogHelper.title('Google Cloud TTS Synthesizer')

const synthesizer = {}
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
let client = {}

synthesizer.conf = {
  voice: '',
  audioConfig: {
    audioEncoding: 'MP3'
  }
}

/**
 * Initialize Google Cloud Text-to-Speech based on credentials in the JSON file
 * The env variable "GOOGLE_APPLICATION_CREDENTIALS" provides the JSON file path
 */
synthesizer.init = (lang) => {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(
    process.cwd(),
    'core/config/voice/google-cloud.json'
  )
  synthesizer.conf.voice = voices[lang]

  try {
    client = new tts.TextToSpeechClient()

    LogHelper.success('Synthesizer initialized')
  } catch (e) {
    LogHelper.error(`Google Cloud TTS: ${e}`)
  }
}

/**
 * Save string to audio file
 */
synthesizer.save = (speech, em, cb) => {
  const file = path.join(
    TMP_PATH,
    `${Date.now()}-${StringHelper.random(4)}.mp3`
  )

  synthesizer.conf.input = { text: speech }

  client.synthesizeSpeech(synthesizer.conf, (err, res) => {
    if (err) {
      LogHelper.error(`Google Cloud TTS: ${err}`)
      return
    }

    fs.writeFile(file, res.audioContent, 'binary', (err) => {
      if (err) {
        LogHelper.error(`Google Cloud TTS: ${err}`)
        return
      }

      const ffmpeg = new Ffmpeg()
      ffmpeg.setFfmpegPath(ffmpegPath)
      ffmpeg.setFfprobePath(ffprobePath)

      // Get file duration thanks to ffprobe
      ffmpeg.input(file).ffprobe((err, data) => {
        if (err) LogHelper.error(err)
        else {
          const duration = data.streams[0].duration * 1_000
          em.emit('saved', duration)
          cb(file, duration)
        }
      })
    })
  })
}

export default synthesizer
