import log from '@/helpers/log'

import buildApp from './build-app';

/**
 * Execute the building app script
 */
(async () => {
  try {
    await buildApp()
  } catch (e) {
    log.error(`Failed to build: ${e}`)
  }
})()
