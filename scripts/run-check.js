import { LOADER } from '@/helpers/loader'

import check from './check'

/**
 * Execute the checking script
 */
;(async () => {
  try {
    LOADER.start()
    await check()
    LOADER.stop()
  } catch (e) {
    LOADER.stop()
  }
})()
