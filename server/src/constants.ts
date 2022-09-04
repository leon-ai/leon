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
