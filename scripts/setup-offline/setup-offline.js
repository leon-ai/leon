import dotenv from 'dotenv'

import { LoaderHelper } from '@/helpers/loader-helper'
import { LogHelper } from '@/helpers/log-helper'

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
    LogHelper.success('Hooray! Offline components are installed!')
  } catch (e) {
    LogHelper.error(e)
    LoaderHelper.stop()
  }
})()
