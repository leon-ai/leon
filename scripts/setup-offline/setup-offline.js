import dotenv from 'dotenv'

import loader from '@/helpers/loader'
import { log } from '@/helpers/log'

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
    loader.start()
    await checkOs()
    loader.stop()
    await setupHotword()
    loader.start()
    await setupTts()
    await setupStt()

    loader.stop()
    log.success('Hooray! Offline components are installed!')
  } catch (e) {
    log.error(e)
    loader.stop()
  }
})()
