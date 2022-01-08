import dotenv from 'dotenv'

import server from '@/core/server'

(async () => {
  dotenv.config()

  await server.init()
})()
