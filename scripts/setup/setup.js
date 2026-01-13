import { IS_GITHUB_ACTIONS } from '@/constants'
import { LoaderHelper } from '@/helpers/loader-helper'
import { LogHelper } from '@/helpers/log-helper'

import train from '../train/train'
import generateHTTPAPIKey from '../generate/generate-http-api-key'
import generateJSONSchemas from '../generate/generate-json-schemas'

import setupDotenv from './setup-dotenv'
import setupCore from './setup-core'
import setupSkills from './setup-skills/setup-skills'
import setupLLM from './setup-llm'
import setupCUDARuntime from './setup-cuda-runtime.js'
import setupBinaries from './setup-binaries'
import setupTCPServerModels from './setup-tcp-server-models'
import createInstanceID from './create-instance-id'
import setFfprobePermissions from './set-ffprobe-permissions'

// Do not load ".env" file because it is not created yet

/**
 * Main entry to set up Leon
 */
;(async () => {
  try {
    await setupDotenv()
    LoaderHelper.start()
    await setupCore()
    await setupSkills()
    LoaderHelper.stop()
    if (!IS_GITHUB_ACTIONS) {
      await setupLLM()
      await setupCUDARuntime()
    } else {
      LogHelper.info('Skipping LLM and CUDA setups because it is running in CI')
    }

    await setupBinaries()
    await setupTCPServerModels()
    await generateHTTPAPIKey()
    await generateJSONSchemas()
    LoaderHelper.start()
    await train()
    await setFfprobePermissions()
    await createInstanceID()

    LogHelper.default('')
    LogHelper.success('Hooray! Leon is installed and ready to go!')
    LoaderHelper.stop()
  } catch (e) {
    LogHelper.error(e)
    LoaderHelper.stop()
  }
})()
