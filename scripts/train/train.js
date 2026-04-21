import dotenv from 'dotenv'

import { PROFILE_DOT_ENV_PATH } from '@/constants'
import { createSetupStatus } from '../setup/setup-status'

import trainSkillRouterDuty from './train-skill-router-duty.js'

dotenv.config({ path: PROFILE_DOT_ENV_PATH })

/**
 * Training utterance samples script
 *
 * pnpm run train [en or fr]
 */
export default (options = {}) =>
  new Promise(async (resolve, reject) => {
    const { quiet = false } = options
    const status = quiet
      ? null
      : createSetupStatus('Training the skill router...').start()

    try {
      try {
        await trainSkillRouterDuty()

        if (status) {
          status.succeed('Skill router: ready')
        }

        resolve()
      } catch {
        if (status) {
          status.fail('Failed to train the skill router')
        }

        reject()
      }
    } catch (e) {
      if (status) {
        status.fail('Failed to train the skill router')
      }

      reject(e)
    }
  })
