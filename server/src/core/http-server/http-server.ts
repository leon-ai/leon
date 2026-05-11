import fs from 'node:fs'
import path, { join } from 'node:path'
import { spawn } from 'node:child_process'

import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'

import {
  CODEBASE_PATH,
  API_VERSION,
  LEON_VERSION,
  LEON_NODE_ENV,
  HAS_OVER_HTTP,
  IS_TELEMETRY_ENABLED,
  TMP_PATH
} from '@/constants'
import { LogHelper } from '@/helpers/log-helper'
import { DateHelper } from '@/helpers/date-helper'
import { corsMidd } from '@/core/http-server/plugins/cors'
import { otherMidd } from '@/core/http-server/plugins/other'
import { infoPlugin } from '@/core/http-server/api/info'
import { inferencePlugin } from '@/core/http-server/api/inference'
import { runActionPlugin } from '@/core/http-server/api/run-action'
import { fetchWidgetPlugin } from '@/core/http-server/api/fetch-widget'
import { conversationHistoryPlugin } from '@/core/http-server/api/conversation-history'
import { commandPlugin } from '@/core/http-server/api/command'
import { systemWidgetsPlugin } from '@/core/http-server/api/system-widgets'
import { sessionsPlugin } from '@/core/http-server/api/sessions'
import { keyMidd } from '@/core/http-server/plugins/key'
import { utterancePlugin } from '@/core/http-server/api/utterance'
import { openPathPlugin } from '@/core/http-server/api/open-path'
import { fileSystemListPlugin } from '@/core/http-server/api/file-system-list'
import { PERSONA } from '@/core'
import { SystemHelper } from '@/helpers/system-helper'
import { getRoutingModeLLMDisplay } from '@/core/llm-manager/llm-routing'
import { CONFIG_STATE } from '@/core/config-states/config-state'

const LEON_OPEN_BROWSER_GUARD_PREFIX = 'open-browser'

export interface APIOptions {
  apiVersion: string
}

export default class HTTPServer {
  private static instance: HTTPServer

  private fastify = Fastify()

  public httpServer = this.fastify.server

  constructor(
    public readonly host: string,
    public readonly port: number
  ) {
    if (!HTTPServer.instance) {
      LogHelper.title('HTTP Server')
      LogHelper.success('New instance')

      HTTPServer.instance = this
    }

    this.host = host
    this.port = port
  }

  /**
   * Open Leon in the default browser once per runtime launcher.
   */
  private async openBrowserOnStartup(): Promise<void> {
    if (
      process.env['IS_DOCKER'] === 'true' ||
      process.env['CI'] === 'true' ||
      process.env['LEON_OPEN_BROWSER'] !== 'true'
    ) {
      return
    }

    const guardPath = path.join(
      TMP_PATH,
      `${LEON_OPEN_BROWSER_GUARD_PREFIX}-${process.ppid}`
    )

    await fs.promises.mkdir(TMP_PATH, { recursive: true })

    try {
      const fileHandle = await fs.promises.open(guardPath, 'wx')

      await fileHandle.close()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return
      }

      throw error
    }

    const leonURL = `${this.host}:${this.port}`
    const browserCommand = SystemHelper.isWindows()
      ? {
          command: 'cmd.exe',
          args: ['/c', 'start', '""', leonURL]
        }
      : SystemHelper.isMacOS()
        ? {
            command: 'open',
            args: [leonURL]
          }
        : {
            command: 'xdg-open',
            args: [leonURL]
          }

    await new Promise<void>((resolve, reject) => {
      const child = spawn(browserCommand.command, browserCommand.args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })

      child.once('error', reject)
      child.once('spawn', () => {
        child.unref()
        resolve()
      })
    })
  }

  /**
   * Server entry point
   */
  public async init(): Promise<void> {
    this.fastify.addHook('onRequest', corsMidd)
    this.fastify.addHook('preValidation', otherMidd)

    LogHelper.title('Initialization')
    LogHelper.info(`Environment: ${LEON_NODE_ENV}`)
    LogHelper.info(`Version: ${LEON_VERSION}`)
    LogHelper.info(`Time zone: ${DateHelper.getTimeZone()}`)
    const routingMode = CONFIG_STATE.getRoutingModeState().getRoutingMode()
    const modelState = CONFIG_STATE.getModelState()
    const llmDisplay = getRoutingModeLLMDisplay(
      routingMode,
      modelState.getWorkflowTarget(),
      modelState.getAgentTarget()
    )
    LogHelper.info(`Routing mode: ${routingMode}`)
    LogHelper.info(`${llmDisplay.heading}: ${llmDisplay.value}`)
    LogHelper.info(`Mood: ${PERSONA.mood.type}`)
    LogHelper.info(
      `GPU: ${(await SystemHelper.getGPUDeviceNames())[0] || 'unknown'}`
    )
    LogHelper.info(
      `Graphics compute API: ${await SystemHelper.getGraphicsComputeAPI()}`
    )
    LogHelper.info(`Total VRAM: ${await SystemHelper.getTotalVRAM()} GB`)

    const isTelemetryEnabled = IS_TELEMETRY_ENABLED ? 'enabled' : 'disabled'
    LogHelper.info(`Telemetry: ${isTelemetryEnabled}`)

    await this.bootstrap()
  }

  /**
   * Bootstrap API
   */
  private async bootstrap(): Promise<void> {
    // Render the web app
    this.fastify.register(fastifyStatic, {
      root: join(CODEBASE_PATH, 'app', 'dist'),
      prefix: '/'
    })
    this.fastify.get('/', (_request, reply) => {
      reply.sendFile('index.html')
    })

    this.fastify.register(runActionPlugin, { apiVersion: API_VERSION })
    this.fastify.register(fetchWidgetPlugin, { apiVersion: API_VERSION })
    this.fastify.register(conversationHistoryPlugin, {
      apiVersion: API_VERSION
    })
    this.fastify.register(systemWidgetsPlugin, { apiVersion: API_VERSION })
    this.fastify.register(sessionsPlugin, { apiVersion: API_VERSION })
    this.fastify.register(infoPlugin, { apiVersion: API_VERSION })
    this.fastify.register(commandPlugin, { apiVersion: API_VERSION })
    this.fastify.register(inferencePlugin, { apiVersion: API_VERSION })
    this.fastify.register(openPathPlugin, { apiVersion: API_VERSION })
    this.fastify.register(fileSystemListPlugin, { apiVersion: API_VERSION })

    if (HAS_OVER_HTTP) {
      this.fastify.register((instance, _opts, next) => {
        instance.addHook('preHandler', keyMidd)

        instance.register(utterancePlugin, { apiVersion: API_VERSION })

        // TODO: reimplement skills routes once the new core is ready
        // server.generateSkillsRoutes(instance)

        next()
      })
    }

    try {
      await this.listen()
    } catch (e) {
      LogHelper.error((e as Error).message)
    }
  }

  /**
   * Launch server
   */
  private async listen(): Promise<void> {
    this.fastify.listen(
      {
        port: this.port,
        host: '0.0.0.0'
      },
      () => {
        LogHelper.title('Initialization')
        LogHelper.success(`Server is available at ${this.host}:${this.port}`)

        void this.openBrowserOnStartup().catch((error: Error) => {
          LogHelper.warning(
            `Could not open Leon in the browser automatically: ${error.message}`
          )
        })
      }
    )
  }
}
