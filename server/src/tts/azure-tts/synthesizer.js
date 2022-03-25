import * as sdk from 'microsoft-cognitiveservices-speech-sdk'
import { SpeechSynthesizer } from 'microsoft-cognitiveservices-speech-sdk'
import Ffmpeg from 'fluent-ffmpeg'
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg'
import { path as ffprobePath } from '@ffprobe-installer/ffprobe'
import fs from 'fs'

import log from '@/helpers/log'
import string from '@/helpers/string'

log.title('Azure TTS Synthesizer')

let client = { }
const synthesizer = { }
const voices = {
  'en-US': {
    voice: 'en-US-AmberNeural'
  }
}

const file = `${__dirname}/../../tmp/${Date.now()}-${string.random(4)}.wav`
const config = JSON.parse(
  fs.readFileSync(`${__dirname}/../../config/voice/azure-tts.json`, 'utf8')
)
const speechConfig = sdk.SpeechConfig.fromSubscription(
  config.key,
  config.region
)
const audioConfig = sdk.AudioConfig.fromAudioFileOutput(file)
speechConfig.speechSynthesisLanguage = 'en-US'
speechConfig.speechSynthesisVoiceName = voices[process.env.LEON_LANG].voice

/**
 * Initialize Azure Text-to-Speech based on credentials in the JSON file
 */

synthesizer.init = () => {
  try {
    client = new SpeechSynthesizer(speechConfig, audioConfig)
    log.success('Synthesizer initialized')
  } catch (e) {
    log.error(`Azure TTS: ${e}`)
  }
}

/*
 * Save string to audio file
 */

synthesizer.save = (speech, em, cb) => {
  client = new SpeechSynthesizer(speechConfig, audioConfig)
  client.speakTextAsync(speech, ({ result }) => {
    synthesizer.close()
    // if (result) {
    //   return fs.createWriteStream(file)
    // }

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
      log.error(`Azure TTS: ${err}`)
    })
  })
}

export default synthesizer
