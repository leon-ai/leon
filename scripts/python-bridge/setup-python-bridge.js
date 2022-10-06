import { command } from 'execa'

import { LogHelper } from '@/helpers/log-helper'
import { LoaderHelper } from '@/helpers/loader-helper'

/**
 * Set up Python bridge development environment
 * 1. Install Python packages from the Pipfile
 */

const PIPFILE_PATH = 'bridges/python/src/Pipfile'

;(async () => {
  LoaderHelper.start()
  LogHelper.info('Setting up Python bridge development environment...')
  LogHelper.info(`Installing Python packages from ${PIPFILE_PATH}.lock...`)

  try {
    process.env.PIPENV_PIPFILE = PIPFILE_PATH
    process.env.PIPENV_VENV_IN_PROJECT = true
    // As per: https://github.com/marcelotduarte/cx_Freeze/issues/1548
    process.env.PIP_NO_BINARY = 'cx_Freeze'

    await command(`pipenv install --site-packages`, {
      shell: true
    })

    LogHelper.success('Python packages installed')
    LogHelper.success('Python bridge development environment ready')
  } catch (e) {
    LogHelper.error(`Failed to set up Python bridge: ${e}`)
  } finally {
    LoaderHelper.stop()
  }
})()
