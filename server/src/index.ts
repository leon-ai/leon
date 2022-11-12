import { spawn } from 'node:child_process'

import {
  IS_DEVELOPMENT_ENV,
  LANG as LEON_LANG,
  TCP_SERVER_BIN_PATH
} from '@/constants'
import { LangHelper } from '@/helpers/lang-helper'
import { TCP_CLIENT } from '@/core/tcp-client'
import server from '@/core/http-server/server'
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

  // Start the core server
  await server.init()
})()
