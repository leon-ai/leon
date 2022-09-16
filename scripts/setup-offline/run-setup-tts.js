import { log } from '@/helpers/log'

import setupTts from './setup-tts'

/**
 * Execute the setup offline TTS script
 */
;(async () => {
  try {
    await setupTts()
  } catch (e) {
    log.error(`Failed to setup offline TTS: ${e}`)
  }
})()
