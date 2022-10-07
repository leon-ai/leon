import path from 'node:path'
import fs from 'node:fs'

import { command } from 'execa'
import archiver from 'archiver'
import prettyBytes from 'pretty-bytes'

import {
  PYTHON_BRIDGE_SRC_PATH,
  TCP_SERVER_SRC_PATH,
  BINARIES_FOLDER_NAME,
  PYTHON_BRIDGE_DIST_PATH,
  TCP_SERVER_DIST_PATH,
  PYTHON_BRIDGE_BIN_NAME,
  TCP_SERVER_BIN_NAME
} from '@/constants'
import { LogHelper } from '@/helpers/log-helper'
import { LoaderHelper } from '@/helpers/loader-helper'
import { OSHelper, OSTypes } from '@/helpers/os-helper'

/**
 * Build binaries for the given OS according to the given build target
 * 1. Get the correct OS platform and CPU architecture
 * 2. If Linux, install the required dependencies
 * 3. Build the given build target
 * 4. Pack the distribution entities into a ZIP file
 */

const BUILD_TARGETS = new Map()

BUILD_TARGETS.set('python-bridge', {
  name: 'Python bridge',
  pipfilePath: path.join(PYTHON_BRIDGE_SRC_PATH, 'Pipfile'),
  setupFilePath: path.join(PYTHON_BRIDGE_SRC_PATH, 'setup.py'),
  distPath: PYTHON_BRIDGE_DIST_PATH,
  archiveName: `${PYTHON_BRIDGE_BIN_NAME}-${BINARIES_FOLDER_NAME}.zip`,
  dotVenvPath: path.join(PYTHON_BRIDGE_SRC_PATH, '.venv')
})
BUILD_TARGETS.set('tcp-server', {
  name: 'TCP server',
  pipfilePath: path.join(TCP_SERVER_SRC_PATH, 'Pipfile'),
  setupFilePath: path.join(TCP_SERVER_SRC_PATH, 'setup.py'),
  distPath: TCP_SERVER_DIST_PATH,
  archiveName: `${TCP_SERVER_BIN_NAME}-${BINARIES_FOLDER_NAME}.zip`,
  dotVenvPath: path.join(TCP_SERVER_SRC_PATH, '.venv')
})
;(async () => {
  LoaderHelper.start()

  const { argv } = process
  const givenBuildTarget = argv[2].toLowerCase()

  if (!BUILD_TARGETS.has(givenBuildTarget)) {
    LogHelper.error(
      `Invalid build target: ${givenBuildTarget}. Valid targets are: ${Array.from(
        BUILD_TARGETS.keys()
      ).join(', ')}`
    )
    process.exit(1)
  }

  const {
    name: buildTarget,
    pipfilePath,
    setupFilePath,
    distPath,
    archiveName,
    dotVenvPath
  } = BUILD_TARGETS.get(givenBuildTarget)
  const buildPath = path.join(distPath, BINARIES_FOLDER_NAME)

  const { type: osType } = OSHelper.getInformation()

  /**
   * Install requirements
   */
  try {
    if (osType === OSTypes.Linux) {
      LogHelper.info('Checking whether the "patchelf" utility can be found...')

      await command('patchelf --version', { shell: true })

      LogHelper.success('The "patchelf" utility has been found')
    }
  } catch (e) {
    const installPatchelfCommand = 'sudo apt install patchelf'

    LogHelper.error(
      `The "patchelf" utility is not installed. Please run the following command: "${installPatchelfCommand}" or install it via a packages manager supported by your Linux distribution such as DNF, YUM, etc. Then try again`
    )
    process.exit(1)
  }

  /**
   * Build
   */
  try {
    LogHelper.info(`Building the ${buildTarget}...`)

    // Required environment variables to set up
    process.env.PIPENV_PIPFILE = pipfilePath
    process.env.PIPENV_VENV_IN_PROJECT = true

    await command(
      `pipenv run python ${setupFilePath} build --build-exe ${buildPath}`,
      {
        shell: true,
        stdio: 'inherit'
      }
    )

    LogHelper.success(`The ${buildTarget} has been built`)
  } catch (e) {
    LogHelper.error(
      `An error occurred while building the ${buildTarget}. Try to delete the ${dotVenvPath} folder, run the setup command then build again: ${e}`
    )
    process.exit(1)
  }

  /**
   * Pack distribution entities into a ZIP archive
   */
  const archivePath = path.join(distPath, archiveName)
  LogHelper.info(`Packing to ${archivePath}...`)

  const output = fs.createWriteStream(archivePath)
  const archive = archiver('zip')

  output.on('close', () => {
    const size = prettyBytes(archive.pointer())

    LogHelper.info(`Total archive size: ${size}`)
    LogHelper.success(`${buildTarget} has been packed to ${archivePath}`)
    process.exit(0)
  })

  archive.on('error', (err) => {
    LogHelper.error(
      `An error occurred while packing the ${buildTarget}: ${err}`
    )
  })

  archive.pipe(output)

  archive.directory(buildPath, BINARIES_FOLDER_NAME)

  await archive.finalize()
})()
