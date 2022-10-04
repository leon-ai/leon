import { LoaderHelper } from '@/helpers/loader-helper'
import { LogHelper } from '@/helpers/log-helper'

import train from '../train/train'
import generateHttpApiKey from '../generate/generate-http-api-key'

import setupDotenv from './setup-dotenv'
import setupCore from './setup-core'
import setupSkillsConfig from './setup-skills-config'
import setupPythonPackages from './setup-python-packages'

// Do not load ".env" file because it is not created yet

/**
 * Main entry to set up Leon
 */
;(async () => {
  try {
    // Required env vars to setup
    process.env.PIPENV_PIPFILE = 'bridges/python/src/Pipfile'
    process.env.PIPENV_VENV_IN_PROJECT = 'true'

    await setupDotenv()
    LoaderHelper.start()
    await Promise.all([setupCore(), setupSkillsConfig()])
    await setupPythonPackages()
    LoaderHelper.stop()
    await generateHttpApiKey()
    LoaderHelper.start()
    await train()

    LogHelper.default('')
    LogHelper.success('Hooray! Leon is installed and ready to go!')
    LoaderHelper.stop()
  } catch (e) {
    LogHelper.error(e)
    LoaderHelper.stop()
  }
})()
