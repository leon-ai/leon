import fs from 'node:fs'
import path from 'node:path'
import stream from 'node:stream'

import axios from 'axios'
import extractZip from 'extract-zip'

import {
  BINARIES_FOLDER_NAME,
  GITHUB_URL,
  PYTHON_BRIDGE_DIST_PATH,
  TCP_SERVER_DIST_PATH,
  PYTHON_BRIDGE_BIN_NAME,
  TCP_SERVER_BIN_NAME,
  PYTHON_BRIDGE_VERSION,
  TCP_SERVER_VERSION
} from '@/constants'
import { LogHelper } from '@/helpers/log-helper'

/**
 * Set up Python binaries according to the given setup target
 * 1. Delete the existing dist binaries if already exist
 * 2. Download the latest Python binaries from GitHub releases
 * 3. Extract the downloaded ZIP file to the dist folder
 */

const PYTHON_TARGETS = new Map()

PYTHON_TARGETS.set('python-bridge', {
  name: 'Python bridge',
  distPath: PYTHON_BRIDGE_DIST_PATH,
  archiveName: `${PYTHON_BRIDGE_BIN_NAME}-${BINARIES_FOLDER_NAME}.zip`,
  version: PYTHON_BRIDGE_VERSION
})
PYTHON_TARGETS.set('tcp-server', {
  name: 'TCP server',
  distPath: TCP_SERVER_DIST_PATH,
  archiveName: `${TCP_SERVER_BIN_NAME}-${BINARIES_FOLDER_NAME}.zip`,
  version: TCP_SERVER_VERSION
})

const setupPythonBinaries = async (key) => {
  const { name, distPath, archiveName, version } = PYTHON_TARGETS.get(key)

  LogHelper.info(`Setting up ${name}...`)

  const buildPath = path.join(distPath, BINARIES_FOLDER_NAME)
  const archivePath = path.join(distPath, archiveName)

  await Promise.all([
    fs.promises.rm(buildPath, { recursive: true, force: true }),
    fs.promises.rm(archivePath, { recursive: true, force: true })
  ])

  try {
    const archiveWriter = fs.createWriteStream(archivePath)
    const latestReleaseAssetURL = `${GITHUB_URL}/releases/download/${key}_v${version}/${archiveName}`
    const { data } = await axios.get(latestReleaseAssetURL, {
      responseType: 'stream'
    })

    data.pipe(archiveWriter)
    await stream.promises.finished(archiveWriter)

    const absoluteDistPath = path.resolve(distPath)
    await extractZip(archivePath, { dir: absoluteDistPath })

    LogHelper.success(`${name} ready`)
  } catch (error) {
    throw new Error(`Failed to set up ${name}: ${error}`)
  }
}

export default async () => {
  await setupPythonBinaries('python-bridge')
  await setupPythonBinaries('tcp-server')
}
