import { join } from 'node:path'

import Fastify, { FastifySchema } from 'fastify'
import fastifyStatic from '@fastify/static'
import { Type } from '@sinclair/typebox'
import type { Static } from '@sinclair/typebox'

import { version } from '@@/package.json'
import { LEON_NODE_ENV, HAS_LOGGER, HAS_OVER_HTTP } from '@/constants'
import { LogHelper } from '@/helpers/log-helper'
import { DateHelper } from '@/helpers/date-helper'
import { corsMidd } from '@/core/http-server/plugins/cors'
import { otherMidd } from '@/core/http-server/plugins/other'
import { infoPlugin } from '@/core/http-server/api/info'
import { downloadsPlugin } from '@/core/http-server/api/downloads'
import { keyMidd } from '@/core/http-server/plugins/key'
import { NLU, BRAIN } from '@/core'

const API_VERSION = 'v1'

export interface APIOptions {
  apiVersion: string
}

const postQuerySchema = {
  body: Type.Object({
    utterance: Type.String()
  })
} satisfies FastifySchema

interface PostQuerySchema {
  body: Static<typeof postQuerySchema.body>
}

export default class HTTPServer {
  private static instance: HTTPServer

  private fastify = Fastify()

  public httpServer = this.fastify.server

  constructor(public readonly host: string, public readonly port: number) {
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
    LogHelper.info(`The current env is ${LEON_NODE_ENV}`)
    LogHelper.info(`The current version is ${version}`)

    LogHelper.info(`The current time zone is ${DateHelper.getTimeZone()}`)

    const sLogger = !HAS_LOGGER ? 'disabled' : 'enabled'
    LogHelper.info(`Collaborative logger ${sLogger}`)

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

    this.fastify.register(infoPlugin, { apiVersion: API_VERSION })
    this.fastify.register(downloadsPlugin, { apiVersion: API_VERSION })

    if (HAS_OVER_HTTP) {
      this.fastify.register((instance, _opts, next) => {
        instance.addHook('preHandler', keyMidd)

        instance.route<{
          Body: PostQuerySchema['body']
        }>({
          method: 'POST',
          url: '/api/query',
          schema: postQuerySchema,
          handler: async (request, reply) => {
            const { utterance } = request.body

            try {
              BRAIN.isMuted = true
              const data = await NLU.process(utterance)

              reply.send({
                ...data,
                success: true
              })
            } catch (error) {
              const message = error instanceof Error ? error.message : error
              reply.statusCode = 500
              reply.send({
                message,
                success: false
              })
            }
          }
        })

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
