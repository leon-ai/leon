import { LOG } from '@/helpers/log'

import setupTts from './setup-tts'

/**
 * Execute the setup offline TTS script
 */
;(async () => {
  try {
    await setupTts()
  } catch (e) {
    LOG.error(`Failed to setup offline TTS: ${e}`)
  }
})()
