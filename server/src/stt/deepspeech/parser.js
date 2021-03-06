import wav from 'node-wav'
import fs from 'fs'

import log from '@/helpers/log'

log.title('DeepSpeech Parser')

const parser = { }
let DeepSpeech = { }

/* istanbul ignore next */
try {
  DeepSpeech = require('deepspeech-gpu') // eslint-disable-line global-require, import/no-unresolved

  log.success('GPU version found')
} catch (eGpu) {
  console.log(eGpu)
  log.info('GPU version not found, trying to get the CPU version...')

  try {
    DeepSpeech = require('deepspeech') // eslint-disable-line global-require, import/no-unresolved

    log.success('CPU version found')
  } catch (eCpu) {
    log.error(`No DeepSpeech library found:\nGPU: ${eGpu}\nCPU: ${eCpu}`)
  }
}

let model = { }
let desiredSampleRate = 16000

/**
 * Model and language model paths
 */
parser.conf = {
  model: 'bin/deepspeech/deepspeech.pbmm',
  scorer: 'bin/deepspeech/deepspeech.scorer'
}

/**
 * Load models
 */
parser.init = (args) => {
  /* istanbul ignore if */
  if (process.env.LEON_LANG !== 'en-US') {
    log.warning('The DeepSpeech parser only accepts the "en-US" language for the moment')
  }

  log.info(`Loading model from file ${args.model}...`)

  if (!fs.existsSync(args.model)) {
    log.error(`Cannot find ${args.model}. You can setup the offline STT by running: "npm run setup:offline-stt"`)

    return false
  }

  if (!fs.existsSync(args.scorer)) {
    log.error(`Cannot find ${args.scorer}. You can setup the offline STT by running: "npm run setup:offline-stt"`)

    return false
  }

  /* istanbul ignore if */
  if (process.env.LEON_NODE_ENV !== 'testing') {
    model = new DeepSpeech.Model(args.model)
    desiredSampleRate = model.sampleRate()

    model.enableExternalScorer(args.scorer)
  }

  log.success('Model loaded')

  return true
}

/**
 * Parse file and infer
 */
parser.parse = (buffer, cb) => {
  const wavDecode = wav.decode(buffer)

  if (wavDecode.sampleRate < desiredSampleRate) {
    log.warning(`Original sample rate (${wavDecode.sampleRate}) is lower than ${desiredSampleRate}Hz. Up-sampling might produce erratic speech recognition`)
  }

  /* istanbul ignore if */
  if (process.env.LEON_NODE_ENV !== 'testing') {
    const string = model.stt(buffer)

    cb({ string })
  }

  return true
}

export default parser
