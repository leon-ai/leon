import path from 'node:path'
import fs from 'node:fs'

import dotenv from 'dotenv'

import type { LongLanguageCode } from '@/types'
import { SystemHelper } from '@/helpers/system-helper'

dotenv.config()

const PRODUCTION_ENV = 'production'
const DEVELOPMENT_ENV = 'development'
const TESTING_ENV = 'testing'

export const GITHUB_URL = 'https://github.com/leon-ai/leon'

/**
 * Binaries / distribution
 */
export const BINARIES_FOLDER_NAME = SystemHelper.getBinariesFolderName()
export const PYTHON_BRIDGE_DIST_PATH = path.join('bridges', 'python', 'dist')
export const TCP_SERVER_DIST_PATH = path.join('tcp_server', 'dist')

export const PYTHON_BRIDGE_SRC_PATH = path.join('bridges', 'python', 'src')
export const TCP_SERVER_SRC_PATH = path.join('tcp_server', 'src')

const PYTHON_BRIDGE_VERSION_FILE_PATH = path.join(
  PYTHON_BRIDGE_SRC_PATH,
  'version.py'
)
const TCP_SERVER_VERSION_FILE_PATH = path.join(
  TCP_SERVER_SRC_PATH,
  'version.py'
)
export const [, PYTHON_BRIDGE_VERSION] = fs
  .readFileSync(PYTHON_BRIDGE_VERSION_FILE_PATH, 'utf8')
  .split("'")
export const [, TCP_SERVER_VERSION] = fs
  .readFileSync(TCP_SERVER_VERSION_FILE_PATH, 'utf8')
  .split("'")

export const PYTHON_BRIDGE_BIN_NAME = 'leon-python-bridge'
export const TCP_SERVER_BIN_NAME = 'leon-tcp-server'

export const TCP_SERVER_BIN_PATH = path.join(
  TCP_SERVER_DIST_PATH,
  BINARIES_FOLDER_NAME,
  TCP_SERVER_BIN_NAME
)
export const PYTHON_BRIDGE_BIN_PATH = path.join(
  PYTHON_BRIDGE_DIST_PATH,
  BINARIES_FOLDER_NAME,
  PYTHON_BRIDGE_BIN_NAME
)

/**
 * spaCy models
 * Find new spaCy models: https://github.com/explosion/spacy-models/releases
 */
export const EN_SPACY_MODEL_NAME = 'en_core_web_trf'
export const EN_SPACY_MODEL_VERSION = '3.4.0'
export const FR_SPACY_MODEL_NAME = 'fr_core_news_md'
export const FR_SPACY_MODEL_VERSION = '3.4.0'

/**
 * Environments
 */
export const LEON_NODE_ENV = process.env['LEON_NODE_ENV'] || PRODUCTION_ENV
export const IS_PRODUCTION_ENV = LEON_NODE_ENV === PRODUCTION_ENV
export const IS_DEVELOPMENT_ENV = LEON_NODE_ENV === DEVELOPMENT_ENV
export const IS_TESTING_ENV = LEON_NODE_ENV === TESTING_ENV

/**
 * Leon environment preferences
 */
export const LANG = process.env['LEON_LANG'] as LongLanguageCode

export const HOST = process.env['LEON_HOST']
export const PORT = Number(process.env['LEON_PORT'])

export const TIME_ZONE = process.env['LEON_TIME_ZONE']

export const HAS_AFTER_SPEECH = process.env['LEON_AFTER_SPEECH'] === 'true'

export const HAS_STT = process.env['LEON_STT'] === 'true'
export const STT_PROVIDER = process.env['LEON_STT_PROVIDER']
export const HAS_TTS = process.env['LEON_TTS'] === 'true'
export const TTS_PROVIDER = process.env['LEON_TTS_PROVIDER']

export const HAS_OVER_HTTP = process.env['LEON_OVER_HTTP'] === 'true'
export const HTTP_API_KEY = process.env['LEON_HTTP_API_KEY']
export const HTTP_API_LANG = process.env['LEON_HTTP_API_LANG']

export const HAS_LOGGER = process.env['LEON_LOGGER'] === 'true'

export const TCP_SERVER_HOST = process.env['LEON_PY_TCP_SERVER_HOST']
export const TCP_SERVER_PORT = Number(process.env['LEON_PY_TCP_SERVER_PORT'])

/**
 * Paths
 */
export const GLOBAL_DATA_PATH = path.join('core', 'data')
export const VOICE_CONFIG_PATH = path.join('core', 'config', 'voice')
