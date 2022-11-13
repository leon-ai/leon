import { spawn } from 'node:child_process'

import {
  IS_DEVELOPMENT_ENV,
  LANG as LEON_LANG,
  TCP_SERVER_BIN_PATH
} from '@/constants'
import { TCP_CLIENT, HTTP_SERVER } from '@/core'
import { LangHelper } from '@/helpers/lang-helper'
;(async (): Promise<void> => {
  process.title = 'leon'

  // Start the TCP server
  global.tcpServerProcess = spawn(
    `${TCP_SERVER_BIN_PATH} ${LangHelper.getShortCode(LEON_LANG)}`,
    {
      shell: true,
      detached: IS_DEVELOPMENT_ENV
    }
  )

  // Connect the TCP client to the TCP server
  TCP_CLIENT.connect()

  // Start the HTTP server
  // await server.init()
  await HTTP_SERVER.init()

  // TODO
  // Register HTTP API endpoints
  // await HTTP_API.register()

  // TODO
  // const httpServer = HTTP_SERVER.httpServer

  // TODO
  // Start the socket server
  // SOCKET_SERVER.init(httpServer)
})()
