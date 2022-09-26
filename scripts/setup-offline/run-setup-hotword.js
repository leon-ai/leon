import { LogHelper } from '@/helpers/log-helper'

import setupHotword from './setup-hotword'

/**
 * Execute the setup offline hotword script
 */
;(async () => {
  try {
    await setupHotword()
  } catch (e) {
    LogHelper.error(`Failed to setup offline hotword: ${e}`)
  }
})()
