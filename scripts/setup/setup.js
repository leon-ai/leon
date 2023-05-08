import { LoaderHelper } from '@/helpers/loader-helper'
import { LogHelper } from '@/helpers/log-helper'

import train from '../train/train'
import generateHTTPAPIKey from '../generate/generate-http-api-key'
import generateJSONSchemas from '../generate/generate-json-schemas'

import setupDotenv from './setup-dotenv'
import setupCore from './setup-core'
import setupSkillsConfig from './setup-skills-config'
import installNodeJSSkillsPackages from './install-nodejs-skills-packages'
import setupBinaries from './setup-binaries'
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
    await installNodeJSSkillsPackages()
    LoaderHelper.stop()
    await setupBinaries()
    await generateHTTPAPIKey()
    await generateJSONSchemas()
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
