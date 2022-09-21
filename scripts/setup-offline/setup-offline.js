import dotenv from 'dotenv'

import { LOADER } from '@/helpers/loader'
import { LOG } from '@/helpers/log'

import checkOs from '../check-os'
import setupHotword from './setup-hotword'
import setupTts from './setup-tts'
import setupStt from './setup-stt'

dotenv.config()

/**
 * Main entry to setup offline components
 */
;(async () => {
  try {
    LOADER.start()
    await checkOs()
    LOADER.stop()
    await setupHotword()
    LOADER.start()
    await setupTts()
    await setupStt()

    LOADER.stop()
    LOG.success('Hooray! Offline components are installed!')
  } catch (e) {
    LOG.error(e)
    LOADER.stop()
  }
})()
