import dotenv from 'dotenv'

import Server from '@/core/server'

(async () => {
  dotenv.config()

  const server = new Server()
  await server.init()
})()
