'use strict'

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
  log.info('GPU version not found, trying to get the CPU version...')

  try {
    DeepSpeech = require('deepspeech') // eslint-disable-line global-require, import/no-unresolved

    log.success('CPU version found')
  } catch (eCpu) {
    log.error(`No DeepSpeech library found:\nGPU: ${eGpu}\nCPU: ${eCpu}`)
  }
}

/**
 * These constants control the beam search decoder
 */

// Beam width used in the CTC decoder when building candidate transcriptions
const BEAM_WIDTH = 500
// The alpha hyperparameter of the CTC decoder. Language Model weight
const LM_ALPHA = 0.75
// The beta hyperparameter of the CTC decoder. Word insertion weight (penalty)
// const WORD_COUNT_WEIGHT = 1.00;
/**
 * Valid word insertion weight
 * This is used to lessen the word insertion penalty
 * When the inserted word is part of the vocabulary
 */
const LM_BETA = 1.85

/**
 * These constants are tied to the shape of the graph used (changing them changes
 * the geometry of the first layer), so make sure you use the same constants that
 * were used during training
 */

// Number of MFCC features to use
const N_FEATURES = 26
// Size of the context window used for producing timesteps in the input vector
const N_CONTEXT = 9

let model = { }

/**
 * Model and language model paths
 */
parser.conf = {
  model: 'bin/deepspeech/output_graph.pb',
  alphabet: 'bin/deepspeech/alphabet.txt',
  lm: 'bin/deepspeech/lm.binary',
  trie: 'bin/deepspeech/trie'
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

  if (!fs.existsSync(args.alphabet)) {
    log.error(`Cannot find ${args.alphabet}. You can setup the offline STT by running: "npm run setup:offline-stt"`)

    return false
  }

  /* istanbul ignore if */
  if (process.env.LEON_NODE_ENV !== 'testing') {
    model = new DeepSpeech.Model(args.model, N_FEATURES, N_CONTEXT, args.alphabet, BEAM_WIDTH)
  }

  log.success('Model loaded')

  if (args.lm && args.trie) {
    log.info(`Loading language model from files ${args.lm} and ${args.trie}...`)

    if (!fs.existsSync(args.lm)) {
      log.error(`Cannot find ${args.lm}. You can setup the offline STT by running: "npm run setup:offline-stt"`)

      return false
    }

    if (!fs.existsSync(args.trie)) {
      log.error(`Cannot find ${args.trie}. You can setup the offline STT by running: "npm run setup:offline-stt"`)

      return false
    }

    /* istanbul ignore if */
    if (process.env.LEON_NODE_ENV !== 'testing') {
      model.enableDecoderWithLM(args.alphabet, args.lm, args.trie,
        LM_ALPHA, LM_BETA)
    }

    log.success('Language model loaded')
  }

  return true
}

/**
 * Parse file and infer
 */
parser.parse = (buffer, cb) => {
  const wavDecode = wav.decode(buffer)

  if (wavDecode.sampleRate !== 16000) {
    log.error(`The sample rate is not 16 kHz. DeepSpeech needs WAVE files with the following characteristics:
    audio channel "1" (mono), bits per sample "16", sample rate "16 kHz"`)

    return false
  }

  // const audioLength = (buffer.length / 2) * (1 / 16000);
  // We take half of the buffer_size because buffer is a char* while LocalDsSTT() expected a short*

  /* istanbul ignore if */
  if (process.env.LEON_NODE_ENV !== 'testing') {
    const string = model.stt(buffer.slice(0, buffer.length / 2), 16000)

    cb({ string })
  }

  return true
}

export default parser
