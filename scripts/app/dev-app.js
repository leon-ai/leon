import dotenv from 'dotenv'

import buildApp from './build-app'
import serveApp from './serve-app'

dotenv.config();

/**
 * Main entry for the webapp development
 */
(async () => {
  process.env.LEON_NODE_ENV = 'development'

  await buildApp()
  await serveApp()
})()
