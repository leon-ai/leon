import crypto from 'node:crypto'

import dotenv from 'dotenv'

import { LogHelper } from '@/helpers/log-helper'
import { StringHelper } from '@/helpers/string-helper'
import { ProfileHelper } from '@/helpers/profile-helper'
import { PROFILE_DOT_ENV_PATH } from '@/constants'

dotenv.config({ path: PROFILE_DOT_ENV_PATH })

/**
 * Generate HTTP API key script
 * save it in the .env file
 */
const generateHTTPAPIKey = () =>
  new Promise(async (resolve, reject) => {
    LogHelper.info('Generating the HTTP API key...')

    try {
      const shasum = crypto.createHash('sha1')
      const str = StringHelper.random(11)
      const envVarKey = 'LEON_HTTP_API_KEY'

      shasum.update(str)
      const sha1 = shasum.digest('hex')

      await ProfileHelper.updateDotEnvVariable(envVarKey, sha1)
      LogHelper.success('HTTP API key generated')

      resolve()
    } catch (e) {
      LogHelper.error(e.message)
      reject(e)
    }
  })

export default () =>
  new Promise(async (resolve, reject) => {
    try {
      if (
        !process.env.LEON_HTTP_API_KEY ||
        process.env.LEON_HTTP_API_KEY === ''
      ) {
        await generateHTTPAPIKey()
      }

      resolve()
    } catch (e) {
      reject(e)
    }
  })
