import { join } from 'node:path'

import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'

import {
  API_VERSION,
  LEON_VERSION,
  LEON_NODE_ENV,
  HAS_OVER_HTTP,
  IS_TELEMETRY_ENABLED,
  LLM_PROVIDER
} from '@/constants'
import { LogHelper } from '@/helpers/log-helper'
import { DateHelper } from '@/helpers/date-helper'
import { corsMidd } from '@/core/http-server/plugins/cors'
import { otherMidd } from '@/core/http-server/plugins/other'
import { infoPlugin } from '@/core/http-server/api/info'
import { llmInferencePlugin } from '@/core/http-server/api/llm-inference'
import { runActionPlugin } from '@/core/http-server/api/run-action'
import { fetchWidgetPlugin } from '@/core/http-server/api/fetch-widget'
import { keyMidd } from '@/core/http-server/plugins/key'
import { utterancePlugin } from '@/core/http-server/api/utterance'
import { openPathPlugin } from '@/core/http-server/api/open-path'
import { LLM_MANAGER, PERSONA } from '@/core'
import { SystemHelper } from '@/helpers/system-helper'

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
   * Server entry point
   */
  public async init(): Promise<void> {
    this.fastify.addHook('onRequest', corsMidd)
    this.fastify.addHook('preValidation', otherMidd)

    LogHelper.title('Initialization')
    LogHelper.info(`Environment: ${LEON_NODE_ENV}`)
    LogHelper.info(`Version: ${LEON_VERSION}`)
    LogHelper.info(`Time zone: ${DateHelper.getTimeZone()}`)
    LogHelper.info(`LLM provider: ${LLM_PROVIDER}`)
    LogHelper.info(`Mood: ${PERSONA.mood.type}`)
    LogHelper.info(`GPU: ${(await SystemHelper.getGPUDeviceNames())[0]}`)
    LogHelper.info(
      `Graphics compute API: ${await SystemHelper.getGraphicsComputeAPI()}`
    )
    LogHelper.info(`Total VRAM: ${await SystemHelper.getTotalVRAM()} GB`)

    const isLLMEnabled = LLM_MANAGER.isLLMEnabled ? 'enabled' : 'disabled'
    LogHelper.info(`LLM: ${isLLMEnabled}`)

    const isLLMNLGEnabled = LLM_MANAGER.isLLMNLGEnabled ? 'enabled' : 'disabled'
    LogHelper.info(`LLM NLG: ${isLLMNLGEnabled}`)

    const isLLMActionRecognitionEnabled =
      LLM_MANAGER.isLLMActionRecognitionEnabled ? 'enabled' : 'disabled'
    LogHelper.info(`LLM action recognition: ${isLLMActionRecognitionEnabled}`)

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
      root: join(process.cwd(), 'app', 'dist'),
      prefix: '/'
    })
    this.fastify.get('/', (_request, reply) => {
      reply.sendFile('index.html')
    })

    this.fastify.register(runActionPlugin, { apiVersion: API_VERSION })
    this.fastify.register(fetchWidgetPlugin, { apiVersion: API_VERSION })
    this.fastify.register(infoPlugin, { apiVersion: API_VERSION })
    this.fastify.register(llmInferencePlugin, { apiVersion: API_VERSION })
    this.fastify.register(openPathPlugin, { apiVersion: API_VERSION })

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
      }
    )
  }
}
