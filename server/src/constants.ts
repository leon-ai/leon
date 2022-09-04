import dotenv from 'dotenv'

dotenv.config()

const PRODUCTION_ENV = 'production'
const DEVELOPMENT_ENV = 'development'
const TESTING_ENV = 'testing'

export const IS_PRODUCTION_ENV = process.env['LEON_NODE_ENV'] === PRODUCTION_ENV
export const IS_DEVELOPMENT_ENV =
  process.env['LEON_NODE_ENV'] === DEVELOPMENT_ENV
export const IS_TESTING_ENV = process.env['LEON_NODE_ENV'] === TESTING_ENV

export const LANG = process.env['LEON_LANG']

export const HOST = process.env['LEON_HOST']
export const PORT = process.env['LEON_PORT']

export const TIME_ZONE = process.env['LEON_TIME_ZONE']

export const HAS_AFTER_SPEECH = process.env['LEON_AFTER_SPEECH'] === 'true'

export const HAS_STT = process.env['LEON_STT'] === 'true'
export const STT_PROVIDER = process.env['LEON_STT_PROVIDER']
export const HAS_TTS = process.env['LEON_TTS'] === 'true'
export const TTS_PROVIDER = process.env['LEON_TTS_PROVIDER']
