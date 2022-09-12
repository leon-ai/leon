import { Polly, SynthesizeSpeechCommand } from '@aws-sdk/client-polly'
import Ffmpeg from 'fluent-ffmpeg'
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg'
import { path as ffprobePath } from '@ffprobe-installer/ffprobe'
import fs from 'fs'
import path from 'path'

import log from '@/helpers/log'
import { randomString } from '@/helpers/string'

log.title('Amazon Polly Synthesizer')

const synthesizer = {}
const voices = {
  'en-US': {
    VoiceId: 'Matthew'
  },
  'fr-FR': {
    VoiceId: 'Mathieu'
  }
}
let client = {}

synthesizer.conf = {
  OutputFormat: 'mp3',
  VoiceId: ''
}

/**
 * Initialize Amazon Polly based on credentials in the JSON file
 */
synthesizer.init = (lang) => {
  const config = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), 'core/config/voice/amazon.json'),
      'utf8'
    )
  )
  synthesizer.conf.VoiceId = voices[lang].VoiceId

  try {
    client = new Polly(config)

    log.success('Synthesizer initialized')
  } catch (e) {
    log.error(`Amazon Polly: ${e}`)
  }
}

/**
 * Save string to audio file
 */
synthesizer.save = (speech, em, cb) => {
  const file = `${__dirname}/../../tmp/${Date.now()}-${randomString(4)}.mp3`

  synthesizer.conf.Text = speech

  client
    .send(new SynthesizeSpeechCommand(synthesizer.conf))
    .then(({ AudioStream }) => {
      const wStream = fs.createWriteStream(file)

      AudioStream.pipe(wStream)

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
        log.error(`Amazon Polly: ${err}`)
      })
    })
    .catch((err) => {
      if (err.code === 'UnknownEndpoint') {
        log.error(
          `Amazon Polly: the region "${err.region}" does not exist or does not support the Polly service`
        )
      } else {
        log.error(`Amazon Polly: ${err.message}`)
      }
    })
}

export default synthesizer
