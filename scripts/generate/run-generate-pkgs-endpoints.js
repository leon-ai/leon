import log from '@/helpers/log'

import generatePkgsEndpoints from './generate-pkgs-endpoints'

/**
 * Execute the generating packages endpoints script
 */
(async () => {
  try {
    await generatePkgsEndpoints()
  } catch (e) {
    log.error(`Failed to generate packages endpoints: ${e}`)
  }
})()
