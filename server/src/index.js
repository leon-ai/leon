import dotenv from 'dotenv'
import { spawn } from 'child_process'

import lang from '@/helpers/lang'
import TcpClient from '@/core/tcp-client'
import server from '@/core/http-server/server'

(async () => {
  dotenv.config()

  spawn(`pipenv run python bridges/python/tcp_server/main.py ${lang.getShortCode(process.env.LEON_LANG)}`, { shell: true, detached: true })

  global.tcpClient = new TcpClient(
    process.env.LEON_PY_WS_SERVER_HOST,
    process.env.LEON_PY_WS_SERVER_PORT
  )

  await server.init()
})()
