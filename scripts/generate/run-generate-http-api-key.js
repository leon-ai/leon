import log from '@/helpers/log'

import generateHttpApiKey from './generate-http-api-key'

/**
 * Execute the generating HTTP API key script
 */
(async () => {
  try {
    await generateHttpApiKey()
  } catch (e) {
    log.error(`Failed to generate the HTTP API key: ${e}`)
  }
})()
