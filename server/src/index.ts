import dotenv from 'dotenv'
import { spawn } from 'child_process'

// import { IS_DEVELOPMENT_ENV } from '@/constants'
import lang from '@/helpers/lang'
import TcpClient from '@/core/tcp-client'
import server from '@/core/http-server/server'
;(async () => {
  dotenv.config()

  process.title = 'leon'

  global.tcpServerProcess = spawn(
    `pipenv run python bridges/python/tcp_server/main.py ${lang.getShortCode(
      process.env['LEON_LANG']
    )}`,
    {
      shell: true
      // detached: IS_DEVELOPMENT_ENV
    }
  )

  /*if (IS_DEVELOPMENT_ENV) {

  }*/

  global.tcpClient = new TcpClient(
    process.env['LEON_PY_TCP_SERVER_HOST'],
    process.env['LEON_PY_TCP_SERVER_PORT']
  )

  await server.init()
})()
