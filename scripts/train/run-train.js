import { LOG } from '@/helpers/log'

import train from './train'

/**
 * Execute the training scripts
 */
;(async () => {
  try {
    await train()
  } catch (e) {
    LOG.error(`Failed to train: ${e}`)
  }
})()
