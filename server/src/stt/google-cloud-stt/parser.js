'use strict'

import stt from '@google-cloud/speech'

import log from '@/helpers/log'

log.title('Google Cloud STT Parser')

const parser = { }
let client = { }

parser.conf = {
  languageCode: process.env.LEON_LANG,
  encoding: 'LINEAR16',
  sampleRateHertz: 16000
}

/**
 * Initialize Google Cloud Speech-to-Text based on the credentials in the JSON file
 * the env variable "GOOGLE_APPLICATION_CREDENTIALS" provides the JSON file path
 */
parser.init = () => {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = `${__dirname}/../../config/voice/google-cloud.json`

  try {
    client = new stt.SpeechClient()

    log.success('Parser initialized')
  } catch (e) {
    log.error(`Google Cloud STT: ${e}`)
  }
}

/**
 * Read buffer and give back a string
 */
parser.parse = async (buffer, cb) => {
  const audioBytes = buffer.toString('base64')
  const audio = { content: audioBytes }

  try {
    const res = await client.recognize({
      audio,
      config: parser.conf
    })
    const string = res[0].results.map(data => data.alternatives[0].transcript).join('\n')

    cb({ string })
  } catch (e) {
    log.error(`Google Cloud STT: ${e}`)
  }
}

export default parser
