import { LOADER } from '@/helpers/loader'
import { LOG } from '@/helpers/log'

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
    process.env.PIPENV_PIPFILE = 'bridges/python/Pipfile'
    process.env.PIPENV_VENV_IN_PROJECT = 'true'

    await setupDotenv()
    LOADER.start()
    await Promise.all([setupCore(), setupSkillsConfig()])
    await setupPythonPackages()
    LOADER.stop()
    await generateHttpApiKey()
    LOADER.start()
    await train()

    LOG.default('')
    LOG.success('Hooray! Leon is installed and ready to go!')
    LOADER.stop()
  } catch (e) {
    LOG.error(e)
    LOADER.stop()
  }
})()
