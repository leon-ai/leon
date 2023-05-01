import { LogHelper } from '@/helpers/log-helper'

import setupStt from './setup-stt'

/**
 * Execute the setup offline STT script
 */
;(async () => {
  try {
    await setupStt()
  } catch (e) {
    LogHelper.error(`Failed to set up offline STT: ${e}`)
  }
})()
