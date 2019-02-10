import log from '@/helpers/log'

import train from './train';

/**
 * Execute the training script
 */
(async () => {
  try {
    await train()
  } catch (e) {
    log.error(`Failed to train: ${e}`)
  }
})()
