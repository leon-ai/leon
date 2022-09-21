import { LOG } from '@/helpers/log'

import buildApp from './build-app'

/**
 * Execute the building app script
 */
;(async () => {
  try {
    await buildApp()
  } catch (e) {
    LOG.error(`Failed to build: ${e}`)
  }
})()
