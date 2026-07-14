import { LogHelper } from '@/helpers/log-helper'

import generateProfileToken from './generate-profile-token'

/**
 * Execute the Leon profile token generator.
 */
;(async () => {
  try {
    await generateProfileToken()
  } catch (e) {
    LogHelper.error(`Failed to generate the Leon profile token: ${e}`)
  }
})()
