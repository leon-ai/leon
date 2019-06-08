'use strict'

import Stt from 'ibm-watson/speech-to-text/v1'
import fs from 'fs'
import { Duplex } from 'stream'

import log from '@/helpers/log'

log.title('Watson STT Parser')

const parser = { }
let client = { }

parser.conf = {
  content_type: 'audio/wav',
  model: `${process.env.LEON_LANG}_BroadbandModel`
}

/**
 * Initialize Watson Speech-to-Text based on credentials in the JSON file
 */
parser.init = () => {
  const credentials = JSON.parse(fs.readFileSync(`${__dirname}/../../config/voice/watson-stt.json`, 'utf8'))

  try {
    client = new Stt(credentials)

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

  client.recognize(parser.conf, (err, res) => {
    if (err) {
      log.error(`Watson STT: ${err}`)
    } else {
      const string = res.results.map(data => data.alternatives[0].transcript).join('\n')

      cb({ string })
    }
  })
}

export default parser
