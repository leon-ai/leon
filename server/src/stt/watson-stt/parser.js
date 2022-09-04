import Stt from 'ibm-watson/speech-to-text/v1'
import { IamAuthenticator } from 'ibm-watson/auth'
import fs from 'fs'
import path from 'path'
import { Duplex } from 'stream'

import { LANG } from '@/constants'
import log from '@/helpers/log'

log.title('Watson STT Parser')

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

    log.success('Parser initialized')
  } catch (e) {
    log.error(`Watson STT: ${e}`)
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
      log.error(`Watson STT: ${err}`)
    })

  client.recognize(parser.conf, (err, res) => {
    if (err) {
      log.error(`Watson STT: ${err}`)
    } else {
      const string = res.results
        .map((data) => data.alternatives[0].transcript)
        .join('\n')

      cb({ string })
    }
  })
}

export default parser
