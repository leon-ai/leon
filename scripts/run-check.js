import { LoaderHelper } from '@/helpers/loader-helper'

import check from './check'

/**
 * Execute the checking script
 */
;(async () => {
  try {
    LoaderHelper.start()
    await check()
    LoaderHelper.stop()
  } catch (e) {
    LoaderHelper.stop()
  }
})()
