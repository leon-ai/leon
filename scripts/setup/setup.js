import loader from '@/helpers/loader'
import log from '@/helpers/log'

import train from '../train'
import generateHttpApiKey from '../generate/generate-http-api-key'
import setupDotenv from './setup-dotenv'
import setupCore from './setup-core'
import setupSkillsConfig from './setup-skills-config'
import setupPythonPackages from './setup-python-packages'

// Do not load ".env" file because it is not created yet

/**
 * Main entry to setup Leon
 */
(async () => {
  try {
    // Required env vars to setup
    process.env.PIPENV_PIPFILE = 'bridges/python/Pipfile'
    process.env.PIPENV_VENV_IN_PROJECT = 'true'

    await setupDotenv()
    loader.start()
    await Promise.all([
      setupCore(),
      setupSkillsConfig()
    ])
    await setupPythonPackages()
    loader.stop()
    await generateHttpApiKey()
    loader.start()
    await train()

    log.default('')
    log.success('Hooray! Leon is installed and ready to go!')
    loader.stop()
  } catch (e) {
    log.error(e)
    loader.stop()
  }
})()
