import loader from '@/helpers/loader'

import check from './check';

/**
 * Execute the checking script
 */
(async () => {
  try {
    loader.start()
    await check()
    loader.stop()
  } catch (e) {
    loader.stop()
  }
})()
