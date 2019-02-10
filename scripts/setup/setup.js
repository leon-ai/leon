import fs from 'fs'

import loader from '@/helpers/loader'
import log from '@/helpers/log'
import os from '@/helpers/os'

import train from '../train'
import setupDotenv from './setup-dotenv'
import setupCore from './setup-core'
import setupPackagesConfig from './setup-packages-config'
import setupPythonPackages from './setup-python-packages';

// Do not load ".env" file because it is not created yet

/**
 * Main entry to setup Leon
 */
(async () => {
  try {
    const info = os.get()

    // Required env vars to setup
    process.env.LEON_LANG = 'en-US'
    process.env.PIPENV_PIPFILE = 'bridges/python/Pipfile'
    process.env.PIPENV_VENV_IN_PROJECT = 'true'

    await setupDotenv()
    loader.start()
    await Promise.all([
      setupCore(),
      setupPackagesConfig()
    ])
    await setupPythonPackages()
    await train()
    if (info.type === 'windows') {
      log.info('Windows detected, reinjecting DeepSpeech into package.json...')
      fs.unlinkSync('package.json')
      fs.renameSync('package.json.backup', 'package.json')
      log.success('DeepSpeech has been reinjected into package.json')
    }

    log.default('')
    log.success('Hooray! Leon is installed and ready to go!')
    loader.stop()
  } catch (e) {
    log.error(e)
    loader.stop()
  }
})()
