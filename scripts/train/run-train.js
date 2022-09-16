import { log } from '@/helpers/log'

import train from './train'

/**
 * Execute the training scripts
 */
;(async () => {
  try {
    await train()
  } catch (e) {
    log.error(`Failed to train: ${e}`)
  }
})()
