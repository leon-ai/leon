import { spawn } from 'child_process'

import {
  TCP_SERVER_HOST,
  TCP_SERVER_PORT,
  IS_DEVELOPMENT_ENV,
  LANG as LEON_LANG
} from '@/constants'
import { LANG } from '@/helpers/lang'
import TcpClient from '@/core/tcp-client'
import server from '@/core/http-server/server'
;(async () => {
  process.title = 'leon'

  global.tcpServerProcess = spawn(
    `pipenv run python bridges/python/tcp_server/main.py ${LANG.getShortLanguageCode(
      LEON_LANG
    )}`,
    {
      shell: true,
      detached: IS_DEVELOPMENT_ENV
    }
  )

  global.tcpClient = new TcpClient(TCP_SERVER_HOST, TCP_SERVER_PORT)

  await server.init()
})()
