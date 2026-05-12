import { spawn } from 'node:child_process'
import fs from 'node:fs'

import psList from 'ps-list'
import kill from 'tree-kill'

import {
  IS_DEVELOPMENT_ENV,
  IS_PRODUCTION_ENV,
  IS_TELEMETRY_ENABLED,
  LANG as LEON_LANG,
  NVIDIA_CUBLAS_PATH,
  NVIDIA_CUDNN_PATH,
  NVIDIA_CUSPARSE_PATH,
  NVIDIA_CUSPARSE_FULL_PATH,
  NVIDIA_NCCL_PATH,
  NVIDIA_NVJITLINK_PATH,
  NVIDIA_NVSHMEM_PATH,
  NVIDIA_LIBS_PATH,
  PYTORCH_TORCH_PATH,
  PYTHON_TCP_SERVER_ENTRY_PATH,
  PYTHON_TCP_SERVER_RUNTIME_BIN_PATH,
  SHOULD_START_PYTHON_TCP_SERVER
} from '@/constants'
import {
  PYTHON_TCP_CLIENT,
  HTTP_SERVER,
  SOCKET_SERVER,
  LLM_PROVIDER,
  LLM_MANAGER,
  TOOLKIT_REGISTRY,
  CONTEXT_MANAGER,
  PULSE_MANAGER
} from '@/core'
import { shouldIgnoreTCPServerError } from '@/utilities'
import { Updater } from '@/updater'
import { Telemetry } from '@/telemetry'
import { LangHelper } from '@/helpers/lang-helper'
import { LogHelper } from '@/helpers/log-helper'
import { RuntimeHelper } from '@/helpers/runtime-helper'
import { SystemHelper } from '@/helpers/system-helper'
import { CONFIG_STATE } from '@/core/config-states/config-state'

async function bootstrap(): Promise<void> {
  process.title = 'leon'
  const shouldStartPythonTCPServer = SHOULD_START_PYTHON_TCP_SERVER

  // Kill any existing Leon process before starting a new one
  const processList = await psList()
  processList
    .filter(
      (p) =>
        (shouldStartPythonTCPServer &&
          (p.cmd?.includes(PYTHON_TCP_SERVER_ENTRY_PATH) ||
            // PyTorch thread from the TCP server (from binary, not from npm start:tcp-server command)
            (p.name?.includes('pt_main_thread') && !p.cmd?.includes('main.py')))) ||
        (p.cmd === process.title && p.pid !== process.pid)
    )
    .forEach((p) => {
      kill(p.pid)
      LogHelper.info(`Killed existing Leon process: ${p.pid}`)
    })

  /**
   * Start the Python TCP server
   *
   * If running "npm start:tcp-server en" cmd,
   * then can manually delete process from task manager to avoid
   * to have 2 TCP servers running at the same time
   */
  if (shouldStartPythonTCPServer) {
    LogHelper.time('TCP Server ready')
    const tcpServerArgs = [
      LangHelper.getShortCode(LEON_LANG),
      '--pytorch-path',
      PYTORCH_TORCH_PATH,
      '--nvidia-path',
      NVIDIA_LIBS_PATH
    ]
    const tcpServerCommandArgs = [PYTHON_TCP_SERVER_ENTRY_PATH, ...tcpServerArgs]
    const tcpServerCmd = RuntimeHelper.buildShellCommand(
      PYTHON_TCP_SERVER_RUNTIME_BIN_PATH,
      tcpServerCommandArgs
    )
    LogHelper.title('Python TCP Server')
    LogHelper.info(`Running command: ${tcpServerCmd}`)

    const tcpServerEnv = { ...process.env }

    if (SystemHelper.isLinux()) {
      const torchLibPath = `${PYTORCH_TORCH_PATH}/lib`
      const nvidiaLibPaths = [
        `${NVIDIA_CUBLAS_PATH}/lib`,
        `${NVIDIA_CUDNN_PATH}/lib`,
        `${NVIDIA_CUSPARSE_PATH}/lib`,
        `${NVIDIA_CUSPARSE_FULL_PATH}/lib`,
        `${NVIDIA_NCCL_PATH}/lib`,
        `${NVIDIA_NVSHMEM_PATH}/lib`,
        `${NVIDIA_NVJITLINK_PATH}/lib`
      ]
      const existingLdPath = tcpServerEnv['LD_LIBRARY_PATH']
      const combinedLdPath = [torchLibPath, ...nvidiaLibPaths, existingLdPath]
        .filter(Boolean)
        .join(':')
      tcpServerEnv['LD_LIBRARY_PATH'] = combinedLdPath
    }

    global.pythonTCPServerProcess = spawn(
      PYTHON_TCP_SERVER_RUNTIME_BIN_PATH,
      tcpServerCommandArgs,
      {
        detached: IS_DEVELOPMENT_ENV,
        env: tcpServerEnv,
        windowsHide: true
      }
    )
    global.pythonTCPServerProcess.stdout.on('data', (data: Buffer) => {
      LogHelper.title('Python TCP Server')
      LogHelper.info(data.toString())

      if (data.toString().includes('connection...')) {
        LogHelper.timeEnd('TCP Server ready')
      }
    })
    global.pythonTCPServerProcess.stderr.on('data', (data: Buffer) => {
      const formattedData = data.toString().trim()
      const shouldIgnore = shouldIgnoreTCPServerError(formattedData)

      if (shouldIgnore) {
        return
      }

      LogHelper.title('Python TCP Server')
      LogHelper.error(data.toString())
    })

    // Connect the Python TCP client to the Python TCP server
    PYTHON_TCP_CLIENT.connect()
  } else {
    LogHelper.title('Python TCP Server')
    LogHelper.info(
      'Skipped startup because routing mode is "agent" and ASR/STT + TTS are disabled'
    )
  }

  try {
    // Start the HTTP server before heavyweight LLM startup so the client can
    // render the initialization UI while local providers continue booting.
    await HTTP_SERVER.init()
  } catch (e) {
    LogHelper.error(`HTTP server failed to init: ${e}`)
  }

  // Start the socket server as early as possible so init status events can
  // flow to the client while the rest of Leon keeps booting.
  await SOCKET_SERVER.init()
  PULSE_MANAGER.start()

  let isLLMProviderReady = false

  try {
    isLLMProviderReady = await LLM_PROVIDER.init()
  } catch (e) {
    LogHelper.error(`LLM Provider failed to init: ${e}`)
  }

  if (isLLMProviderReady) {
    try {
      await LLM_MANAGER.init()
    } catch (e) {
      LogHelper.error(`LLM Manager failed to init: ${e}`)
    }
  } else {
    const hasEnabledLLMTarget = CONFIG_STATE.getModelState().hasEnabledTarget()

    if (hasEnabledLLMTarget) {
      LogHelper.warning(
        'Skipping LLM Manager init because the LLM provider is not ready'
      )
    } else {
      LogHelper.info(
        'Skipping LLM Manager init because no LLM is enabled yet'
      )
    }
  }

  try {
    await TOOLKIT_REGISTRY.load()
  } catch (e) {
    LogHelper.error(`Toolkit Registry failed to load: ${e}`)
  }

  try {
    await CONTEXT_MANAGER.load()
  } catch (e) {
    LogHelper.error(`Context Manager failed to load: ${e}`)
  }

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
  }
  const shutdown = (exitCode = 0): void => {
    LLM_PROVIDER.dispose()

    if (global.pythonTCPServerProcess?.pid) {
      kill(global.pythonTCPServerProcess.pid as number)
    }

    if (IS_TELEMETRY_ENABLED) {
      Telemetry.stop()
    }

    setTimeout(() => {
      process.exit(exitCode)
    }, 1_000)
  }

  ;['exit', 'SIGINT', 'SIGUSR1', 'SIGUSR2', 'SIGTERM', 'SIGHUP'].forEach(
    (eventType) => {
      process.on(eventType, () => {
        shutdown(0)
      })
    }
  )

  process.on('uncaughtException', (error) => {
    LogHelper.title('Server')
    LogHelper.error(`Uncaught exception: ${error instanceof Error ? error.stack || error.message : String(error)}`)
    shutdown(1)
  })

  process.on('unhandledRejection', (reason) => {
    LogHelper.title('Server')
    LogHelper.error(`Unhandled rejection: ${reason instanceof Error ? reason.stack || reason.message : String(reason)}`)
    shutdown(1)
  })
}

void bootstrap()
