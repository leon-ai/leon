import { LoaderHelper } from '@/helpers/loader-helper'
import { LogHelper } from '@/helpers/log-helper'

import train from '../train/train'
import generateHttpApiKey from '../generate/generate-http-api-key'
import generateJsonSchemas from '../generate/generate-json-schemas'

import setupDotenv from './setup-dotenv'
import setupCore from './setup-core'
import setupSkillsConfig from './setup-skills-config'
import setupPythonBinaries from './setup-python-binaries'
import createInstanceID from './create-instance-id'

// Do not load ".env" file because it is not created yet

/**
 * Main entry to set up Leon
 */
;(async () => {
  try {
    await setupDotenv()
    LoaderHelper.start()
    await Promise.all([setupCore(), setupSkillsConfig()])
    LoaderHelper.stop()
    await setupPythonBinaries()
    await generateHttpApiKey()
    await generateJsonSchemas()
    LoaderHelper.start()
    await train()
    await createInstanceID()

    LogHelper.default('')
    LogHelper.success('Hooray! Leon is installed and ready to go!')
    LoaderHelper.stop()
  } catch (e) {
    LogHelper.error(e)
    LoaderHelper.stop()
  }
})()
