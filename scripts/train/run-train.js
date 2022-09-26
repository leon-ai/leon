import { LogHelper } from '@/helpers/log-helper'

import train from './train'

/**
 * Execute the training scripts
 */
;(async () => {
  try {
    await train()
  } catch (e) {
    LogHelper.error(`Failed to train: ${e}`)
  }
})()
