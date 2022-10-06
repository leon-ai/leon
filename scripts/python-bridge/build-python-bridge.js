import path from 'node:path'
import fs from 'node:fs'

import { command } from 'execa'
import archiver from 'archiver'

import { LogHelper } from '@/helpers/log-helper'
import { LoaderHelper } from '@/helpers/loader-helper'
import { OSHelper, OSTypes } from '@/helpers/os-helper'

/**
 * Build Python bridge
 * 1. Get the correct OS platform and CPU architecture
 * 2. If Linux, install the required dependencies
 * 3. Build the Python bridge
 * 4. Pack the distribution entities into a ZIP file
 */

const PIPFILE_PATH = 'bridges/python/src/Pipfile'
const SETUP_FILE_PATH = 'bridges/python/src/setup.py'
const DIST_PATH = 'bridges/python/dist'

const BINARIES_FOLDER_NAME = OSHelper.getBinariesFolderName()
const BUILD_PATH = path.join(DIST_PATH, BINARIES_FOLDER_NAME)

const ARCHIVE_NAME = `leon-python-bridge-${BINARIES_FOLDER_NAME}.zip`
const ARCHIVE_PATH = path.join(DIST_PATH, ARCHIVE_NAME)

;(async () => {
  LoaderHelper.start()

  process.env.PIPENV_PIPFILE = PIPFILE_PATH
  process.env.PIPENV_VENV_IN_PROJECT = true

  const { type } = OSHelper.getInformation()

  try {
    if (type === OSTypes.Linux) {
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

  try {
    LogHelper.info('Building the Python bridge...')

    await command(
      `pipenv run python ${SETUP_FILE_PATH} build --build-exe ${BUILD_PATH}`,
      {
        shell: true
      }
    )

    LogHelper.success('Python bridge built')
  } catch (e) {
    LogHelper.error(`Failed to build the Python bridge: ${e}`)
  }

  LogHelper.info(`Packing to ${ARCHIVE_PATH}...`)

  const output = fs.createWriteStream(ARCHIVE_PATH)
  const archive = archiver('zip')

  output.on('close', () => {
    LogHelper.success(`Python bridge packed to ${ARCHIVE_PATH}`)
    LogHelper.success(
      `Python bridge archive size: ${(archive.pointer() / 1_000_000).toFixed(
        1
      )} MB`
    )
    process.exit(0)
  })

  archive.on('error', (err) => {
    LogHelper.error(`Failed to pack the Python bridge: ${err}`)
  })

  archive.pipe(output)
  archive.directory(BUILD_PATH, BINARIES_FOLDER_NAME)

  await archive.finalize()
})()
