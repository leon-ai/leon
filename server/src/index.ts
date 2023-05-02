import { spawn } from 'node:child_process'
import fs from 'node:fs'

import {
  IS_DEVELOPMENT_ENV,
  IS_TELEMETRY_ENABLED,
  LANG as LEON_LANG,
  TCP_SERVER_BIN_PATH
} from '@/constants'
import { TCP_CLIENT, HTTP_SERVER, SOCKET_SERVER } from '@/core'
import { Telemetry } from '@/telemetry'
import { LangHelper } from '@/helpers/lang-helper'
import { LogHelper } from '@/helpers/log-helper'
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
  await HTTP_SERVER.init()

  // TODO
  // Register HTTP API endpoints
  // await HTTP_API.register()

  // Start the socket server
  SOCKET_SERVER.init()

  // Telemetry events
  if (IS_TELEMETRY_ENABLED) {
    Telemetry.start()

    // Watch for errors in the error log file and report them to the telemetry service
    fs.watchFile(LogHelper.ERRORS_FILE_PATH, async () => {
      const logErrors = await LogHelper.parseErrorLogs()
      const lastError = logErrors[logErrors.length - 1] || ''

      Telemetry.error(lastError)
    })

    setInterval(() => {
      Telemetry.heartbeat()
    }, 1_000 * 3_600 * 6)
    ;[
      'exit',
      'SIGINT',
      'SIGUSR1',
      'SIGUSR2',
      'uncaughtException',
      'SIGTERM'
    ].forEach((eventType) => {
      process.on(eventType, () => {
        Telemetry.stop()

        global.tcpServerProcess.kill()

        setTimeout(() => {
          process.exit(0)
        }, 1_000)
      })
    })
  }
})()
