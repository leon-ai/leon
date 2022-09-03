import log from '@/helpers/log'

import setupHotword from './setup-hotword'

/**
 * Execute the setup offline hotword script
 */
;(async () => {
  try {
    await setupHotword()
  } catch (e) {
    log.error(`Failed to setup offline hotword: ${e}`)
  }
})()
