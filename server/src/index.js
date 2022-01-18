import dotenv from 'dotenv'

import server from '@/core/http-server/server'

(async () => {
  dotenv.config()

  await server.init()
})()
