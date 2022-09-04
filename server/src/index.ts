import { spawn } from 'child_process'

// import { IS_DEVELOPMENT_ENV } from '@/constants'
import { TCP_SERVER_HOST, TCP_SERVER_PORT } from '@/constants'
import lang from '@/helpers/lang'
import TcpClient from '@/core/tcp-client'
import server from '@/core/http-server/server'
;(async () => {
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

  global.tcpClient = new TcpClient(TCP_SERVER_HOST, TCP_SERVER_PORT)

  await server.init()
})()
