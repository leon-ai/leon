import { spawn } from 'node:child_process'
import fs from 'node:fs'

import {
  IS_DEVELOPMENT_ENV,
  IS_PRODUCTION_ENV,
  IS_TELEMETRY_ENABLED,
  LANG as LEON_LANG,
  PYTHON_TCP_SERVER_BIN_PATH
} from '@/constants'
import {
  PYTHON_TCP_CLIENT,
  HTTP_SERVER,
  SOCKET_SERVER,
  LLM_TCP_CLIENT,
  LLM_TCP_SERVER
} from '@/core'
import { Updater } from '@/updater'
import { Telemetry } from '@/telemetry'
import { LangHelper } from '@/helpers/lang-helper'
import { LogHelper } from '@/helpers/log-helper'
;(async (): Promise<void> => {
  process.title = 'leon'

  // Start the Python TCP server
  global.pythonTCPServerProcess = spawn(
    `${PYTHON_TCP_SERVER_BIN_PATH} ${LangHelper.getShortCode(LEON_LANG)}`,
    {
      shell: true,
      detached: IS_DEVELOPMENT_ENV
    }
  )

  // Connect the Python TCP client to the Python TCP server
  PYTHON_TCP_CLIENT.connect()

  try {
    // Start the LLM TCP server
    await LLM_TCP_SERVER.init()
  } catch (e) {
    LogHelper.error(`LLM TCP server failed to init: ${e}`)
  }

  // Connect the LLM TCP client to the LLM TCP server
  LLM_TCP_CLIENT.connect()

  try {
    // Start the HTTP server
    await HTTP_SERVER.init()
  } catch (e) {
    LogHelper.error(`HTTP server failed to init: ${e}`)
  }

  // TODO
  // Register HTTP API endpoints
  // await HTTP_API.register()

  // Start the socket server
  SOCKET_SERVER.init()

  // Check for updates on startup and every 24 hours
  if (IS_PRODUCTION_ENV) {
    Updater.checkForUpdates()
    setInterval(
      () => {
        Updater.checkForUpdates()
      },
      1_000 * 3_600 * 24
    )
  }

  // Telemetry events
  if (IS_TELEMETRY_ENABLED) {
    Telemetry.start()

    // Watch for errors in the error log file and report them to the telemetry service
    fs.watchFile(LogHelper.ERRORS_FILE_PATH, async () => {
      const logErrors = await LogHelper.parseErrorLogs()
      const lastError = logErrors[logErrors.length - 1] || ''

      Telemetry.error(lastError)
    })

    setInterval(
      () => {
        Telemetry.heartbeat()
      },
      1_000 * 3_600 * 6
    )
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

        global.pythonTCPServerProcess.kill()

        setTimeout(() => {
          process.exit(0)
        }, 1_000)
      })
    })
  }
})()
