import { LogHelper } from '@/helpers/log-helper'

import cleanTestDbs from './clean-test-dbs'

/**
 * Execute the cleaning test DBs script
 */
;(async () => {
  try {
    await cleanTestDbs()
  } catch (e) {
    LogHelper.error(`Failed to clean test DBs: ${e}`)
  }
})()
