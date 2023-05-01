import { LogHelper } from '@/helpers/log-helper'

import setupTts from './setup-tts'

/**
 * Execute the setup offline TTS script
 */
;(async () => {
  try {
    await setupTts()
  } catch (e) {
    LogHelper.error(`Failed to set up offline TTS: ${e}`)
  }
})()
