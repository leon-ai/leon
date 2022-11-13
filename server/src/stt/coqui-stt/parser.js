import fs from 'node:fs'

import wav from 'node-wav'
import { Model } from 'stt'

import { IS_TESTING_ENV } from '@/constants'
import { LogHelper } from '@/helpers/log-helper'

LogHelper.title('Coqui STT Parser')

const parser = {}
let model = {}
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
  LogHelper.info(`Loading model from file ${args.model}...`)

  if (!fs.existsSync(args.model)) {
    LogHelper.error(
      `Cannot find ${args.model}. You can set up the offline STT by running: "npm run setup:offline-stt"`
    )

    return false
  }

  if (!fs.existsSync(args.scorer)) {
    LogHelper.error(
      `Cannot find ${args.scorer}. You can setup the offline STT by running: "npm run setup:offline-stt"`
    )

    return false
  }

  /* istanbul ignore if */
  if (!IS_TESTING_ENV) {
    try {
      model = new Model(args.model)
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

  LogHelper.success('Model loaded')

  return true
}

/**
 * Parse file and infer
 */
parser.parse = (buffer, cb) => {
  const wavDecode = wav.decode(buffer)

  if (wavDecode.sampleRate < desiredSampleRate) {
    LogHelper.warning(
      `Original sample rate (${wavDecode.sampleRate}) is lower than ${desiredSampleRate}Hz. Up-sampling might produce erratic speech recognition`
    )
  }

  /* istanbul ignore if */
  if (!IS_TESTING_ENV) {
    const string = model.stt(buffer)

    cb({ string })
  }

  return true
}

export default parser
