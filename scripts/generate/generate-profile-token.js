import crypto from 'node:crypto'

import dotenv from 'dotenv'

import { LogHelper } from '@/helpers/log-helper'
import { ProfileHelper } from '@/helpers/profile-helper'
import { PROFILE_DOT_ENV_PATH } from '@/constants'

dotenv.config({ path: PROFILE_DOT_ENV_PATH })

/**
 * Generate the active Leon profile token
 * save it in the .env file
 */
const generateProfileToken = () =>
  new Promise(async (resolve, reject) => {
    LogHelper.info('Generating my profile token...')

    try {
      const token = crypto.randomBytes(20).toString('hex')
      const envVarKey = 'LEON_PROFILE_TOKEN'

      await ProfileHelper.updateDotEnvVariable(envVarKey, token)
      LogHelper.success('Profile token generated')

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
        (!process.env.LEON_PROFILE_TOKEN ||
          process.env.LEON_PROFILE_TOKEN === '') &&
        (!process.env.LEON_CLIENT_INTERFACE_TOKEN ||
          process.env.LEON_CLIENT_INTERFACE_TOKEN === '')
      ) {
        await generateProfileToken()
      }

      resolve()
    } catch (e) {
      reject(e)
    }
  })
