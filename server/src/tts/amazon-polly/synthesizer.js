'use strict'

import tts from 'aws-sdk'
import Ffmpeg from 'fluent-ffmpeg'
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg'
import { path as ffprobePath } from '@ffprobe-installer/ffprobe'
import fs from 'fs'

import log from '@/helpers/log'
import string from '@/helpers/string'

log.title('Amazon Polly Synthesizer')

const synthesizer = { }
const voices = {
  'en-US': {
    VoiceId: 'Brian'
  },
  'fr-FR': {
    VoiceId: 'Mathieu'
  }
}
let client = { }

synthesizer.conf = {
  OutputFormat: 'mp3',
  VoiceId: voices[process.env.LEON_LANG].VoiceId
}

/**
 * Initialize Amazon Polly based on credentials in the JSON file
 */
synthesizer.init = () => {
  try {
    tts.config.loadFromPath(`${__dirname}/../../config/voice/amazon.json`)

    client = new tts.Polly()

    log.success('Synthesizer initialized')
  } catch (e) {
    log.error(`Amazon Polly: ${e}`)
  }
}

/**
 * Save string to audio file
 */
synthesizer.save = (speech, em, cb) => {
  const file = `${__dirname}/../../tmp/${Date.now()}-${string.random(4)}.mp3`

  synthesizer.conf.Text = speech

  client.synthesizeSpeech(synthesizer.conf, (err, res) => {
    if (err) {
      if (err.code === 'UnknownEndpoint') {
        log.error(`Amazon Polly: the region "${err.region}" does not exist or does not support the Polly service`)
      } else {
        log.error(`Amazon Polly: ${err.message}`)
      }
    } else {
      fs.writeFile(file, res.AudioStream, 'binary', (err) => {
        if (err) {
          log.error(`Amazon Polly: ${err}`)
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
    }
  })
}

export default synthesizer
