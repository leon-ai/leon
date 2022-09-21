import { LOG } from '@/helpers/log'

import cleanTestDbs from './clean-test-dbs'

/**
 * Execute the cleaning test DBs script
 */
;(async () => {
  try {
    await cleanTestDbs()
  } catch (e) {
    LOG.error(`Failed to clean test DBs: ${e}`)
  }
})()
