import { LogHelper } from '@/helpers/log-helper'

import generateHttpApiKey from './generate-http-api-key'

/**
 * Execute the generating HTTP API key script
 */
;(async () => {
  try {
    await generateHttpApiKey()
  } catch (e) {
    LogHelper.error(`Failed to generate the HTTP API key: ${e}`)
  }
})()
