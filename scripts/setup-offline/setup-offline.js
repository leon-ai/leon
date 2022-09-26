import dotenv from 'dotenv'

import { LoaderHelper } from '@/helpers/loader-helper'
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
    LoaderHelper.start()
    await checkOs()
    LoaderHelper.stop()
    await setupHotword()
    LoaderHelper.start()
    await setupTts()
    await setupStt()

    LoaderHelper.stop()
    LOG.success('Hooray! Offline components are installed!')
  } catch (e) {
    LOG.error(e)
    LoaderHelper.stop()
  }
})()
