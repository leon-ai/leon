import path from 'node:path'

import { command } from 'execa'

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
const DIST_PATH = path.join(
  'bridges/python/dist',
  OSHelper.getBinariesFolderName()
)

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
      `pipenv run python ${SETUP_FILE_PATH} build --build-exe ${DIST_PATH}`,
      {
        shell: true
      }
    )

    LogHelper.success('Python bridge built')
  } catch (e) {
    LogHelper.error(`Failed to build the Python bridge: ${e}`)
  } finally {
    LoaderHelper.stop()
  }
})()
