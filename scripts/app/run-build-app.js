import { LogHelper } from '@/helpers/log-helper'

import buildApp from './build-app'

/**
 * Execute the building app script
 */
;(async () => {
  try {
    await buildApp()
  } catch (e) {
    LogHelper.error(`Failed to build: ${e}`)
  }
})()
