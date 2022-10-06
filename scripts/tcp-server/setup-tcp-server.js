import { command } from 'execa'

import { LogHelper } from '@/helpers/log-helper'
import { LoaderHelper } from '@/helpers/loader-helper'

/**
 * Set up TCP server development environment
 * 1. Install Python packages from the Pipfile
 */

const PIPFILE_PATH = 'tcp_server/src/Pipfile'

;(async () => {
  LoaderHelper.start()
  LogHelper.info('Setting up TCP server development environment...')
  LogHelper.info(`Installing Python packages from ${PIPFILE_PATH}.lock...`)

  try {
    process.env.PIPENV_PIPFILE = PIPFILE_PATH
    process.env.PIPENV_VENV_IN_PROJECT = true

    await command(`pipenv install --site-packages`, {
      shell: true
    })

    LogHelper.success('Python packages installed')
    LogHelper.success('TCP server development environment ready')
  } catch (e) {
    LogHelper.error(
      `Failed to set up the TCP server development environment: ${e}`
    )
  } finally {
    LoaderHelper.stop()
  }
})()
