import log from '@/helpers/log'

import generateSkillsEndpoints from './generate-skills-endpoints'

/**
 * Execute the generating skills endpoints script
 */
(async () => {
  try {
    await generateSkillsEndpoints()
  } catch (e) {
    log.error(`Failed to generate skills endpoints: ${e}`)
  }
})()
