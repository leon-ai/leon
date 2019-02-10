import dotenv from 'dotenv'

import serveApp from './serve-app'

dotenv.config();

/**
 * Main entry for the webapp development
 */
(async () => {
  await serveApp()
})()
