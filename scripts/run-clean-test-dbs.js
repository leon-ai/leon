import log from '@/helpers/log'

import cleanTestDbs from './clean-test-dbs'

/**
 * Execute the cleaning test DBs script
 */
(async () => {
  try {
    await cleanTestDbs()
  } catch (e) {
    log.error(`Failed to clean test DBs: ${e}`)
  }
})()
