import { LogHelper } from '@/helpers/log-helper'

import generateSkillsEndpoints from './generate-skills-endpoints'

/**
 * Execute the generating skills endpoints script
 */
;(async () => {
  try {
    await generateSkillsEndpoints()
  } catch (e) {
    LogHelper.error(`Failed to generate skills endpoints: ${e}`)
  }
})()
