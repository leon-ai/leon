import dotenv from 'dotenv'

import TcpClient from '@/core/tcp-client'
import server from '@/core/http-server/server'

(async () => {
  dotenv.config()

  global.tcpClient = new TcpClient(
    process.env.LEON_PY_WS_SERVER_HOST,
    process.env.LEON_PY_WS_SERVER_PORT
  )

  await server.init()
})()
