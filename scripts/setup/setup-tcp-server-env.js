import fs from 'node:fs'
import path from 'node:path'

import execa from 'execa'

import { PYTHON_TCP_SERVER_SRC_PATH } from '@/constants'

import {
  getProjectVenvPythonPath,
  setupPythonProjectEnv
} from './setup-python-project-env'
import { createSetupStatus } from './setup-status'

const NLTK_DATA_DIR_NAME = 'nltk_data'
const NLTK_VENV_DIR_NAME = '.venv'
const PYTHON_TCP_SERVER_VENV_BIN_PATH = getProjectVenvPythonPath(
  PYTHON_TCP_SERVER_SRC_PATH
)
const NLTK_DATA_PATH = path.join(
  PYTHON_TCP_SERVER_SRC_PATH,
  NLTK_VENV_DIR_NAME,
  NLTK_DATA_DIR_NAME
)
const NLTK_DATASETS = [
  {
    id: 'cmudict',
    resourcePath: 'corpora/cmudict'
  },
  {
    id: 'averaged_perceptron_tagger_eng',
    resourcePath: 'taggers/averaged_perceptron_tagger_eng'
  }
]

/**
 * Check whether a required NLTK dataset directory exists in the TCP server venv.
 */
async function isNLTKDatasetInstalled(resourcePath) {
  const datasetPath = path.join(NLTK_DATA_PATH, resourcePath)

  try {
    return (await fs.promises.stat(datasetPath)).isDirectory()
  } catch {
    return false
  }
}

/**
 * NLTK data are used by g2p-en during TTS text normalization.
 *
 * @see https://www.nltk.org/data.html
 */
async function downloadNLTKData() {
  const status = createSetupStatus(
    'Setting up Python TCP server NLTK data...'
  ).start()
  const missingDatasets = []

  await fs.promises.mkdir(NLTK_DATA_PATH, { recursive: true })

  for (const dataset of NLTK_DATASETS) {
    if (!(await isNLTKDatasetInstalled(dataset.resourcePath))) {
      missingDatasets.push(dataset)
    }
  }

  if (missingDatasets.length === 0) {
    status.succeed('Python TCP server NLTK data: up-to-date')

    return
  }

  try {
    status.text = `Downloading Python TCP server NLTK data: ${missingDatasets
      .map(({ id }) => id)
      .join(', ')}`

    await execa(
      PYTHON_TCP_SERVER_VENV_BIN_PATH,
      [
        '-m',
        'nltk.downloader',
        '-d',
        NLTK_DATA_PATH,
        ...missingDatasets.map(({ id }) => id)
      ],
      { stdio: 'ignore' }
    )

    for (const dataset of missingDatasets) {
      if (!(await isNLTKDatasetInstalled(dataset.resourcePath))) {
        throw new Error(`NLTK dataset "${dataset.id}" is still missing`)
      }
    }

    status.succeed('Python TCP server NLTK data: ready')
  } catch (error) {
    status.fail(`Failed to download Python TCP server NLTK data: ${error}`)
    throw error
  }
}

/**
 * Sync the Python TCP server runtime environment from its `pyproject.toml`.
 */
export default async function setupTCPServerEnv() {
  await setupPythonProjectEnv({
    name: 'Python TCP server',
    projectPath: PYTHON_TCP_SERVER_SRC_PATH,
    stampFileName: '.last-tcp-server-deps-sync'
  })
  await downloadNLTKData()
}
