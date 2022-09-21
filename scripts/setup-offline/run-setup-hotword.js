import { LOG } from '@/helpers/log'

import setupHotword from './setup-hotword'

/**
 * Execute the setup offline hotword script
 */
;(async () => {
  try {
    await setupHotword()
  } catch (e) {
    LOG.error(`Failed to setup offline hotword: ${e}`)
  }
})()
