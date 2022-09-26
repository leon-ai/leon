import fs from 'node:fs'
import path from 'node:path'
import { Duplex } from 'node:stream'

import Stt from 'ibm-watson/speech-to-text/v1'
import { IamAuthenticator } from 'ibm-watson/auth'

import { LANG } from '@/constants'
import { LogHelper } from '@/helpers/log-helper'

LogHelper.title('Watson STT Parser')

const parser = {}
let client = {}

parser.conf = {
  contentType: 'audio/wav',
  model: `${LANG}_BroadbandModel`
}

/**
 * Initialize Watson Speech-to-Text based on credentials in the JSON file
 */
parser.init = () => {
  const config = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), 'core/config/voice/watson-stt.json'),
      'utf8'
    )
  )

  try {
    client = new Stt({
      authenticator: new IamAuthenticator({ apikey: config.apikey }),
      serviceUrl: config.url
    })

    LogHelper.success('Parser initialized')
  } catch (e) {
    LogHelper.error(`Watson STT: ${e}`)
  }
}

/**
 * Read buffer and give back a string
 */
parser.parse = async (buffer, cb) => {
  const stream = new Duplex()
  stream.push(buffer)
  stream.push(null)
  parser.conf.audio = stream

  client
    .recognize(parser.conf)
    .then(({ result }) => {
      const string = result.results
        .map((data) => data.alternatives[0].transcript)
        .join('\n')

      cb({ string })
    })
    .catch((err) => {
      LogHelper.error(`Watson STT: ${err}`)
    })

  client.recognize(parser.conf, (err, res) => {
    if (err) {
      LogHelper.error(`Watson STT: ${err}`)
    } else {
      const string = res.results
        .map((data) => data.alternatives[0].transcript)
        .join('\n')

      cb({ string })
    }
  })
}

export default parser
