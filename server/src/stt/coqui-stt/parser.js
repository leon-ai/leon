import wav from 'node-wav'
import fs from 'fs'

import log from '@/helpers/log'

log.title('Coqui-ai Parser')

const parser = { }
let STT = { }

/* istanbul ignore next */
try {
  STT = require('stt-gpu') // eslint-disable-line global-require, import/no-unresolved

  log.success('GPU version found')
} catch (eGpu) {
  log.info('GPU version not found, trying to get the CPU version...')

  try {
    STT = require('stt') // eslint-disable-line global-require, import/no-unresolved

    log.success('CPU version found')
  } catch (eCpu) {
    log.error(`No Coqui-ai library found:\nGPU: ${eGpu}\nCPU: ${eCpu}`)
  }
}

let model = { }
let desiredSampleRate = 16000

/**
 * Model and language model paths
 */
parser.conf = {
  model: 'bin/coqui/model.tflite',
  scorer: 'bin/coqui/huge-vocabulary.scorer'
}

/**
 * Load models
 */
parser.init = (args) => {
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
    try {
      model = new STT.Model(args.model)
    } catch (error) { 
      throw Error(`model.stt: ${error}`)
    } 
    desiredSampleRate = model.sampleRate()

    try {
      model.enableExternalScorer(args.scorer)
    } catch (error) { 
      throw Error(`model.enableExternalScorer: ${error}`)
    } 
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
