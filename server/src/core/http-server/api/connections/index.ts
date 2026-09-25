import type { FastifyPluginAsync, FastifyRequest } from 'fastify'

import type { APIOptions } from '@/core/http-server/http-server'
import { CONNECTION_STORE } from '@/core/connections/connection-store'
import { OAUTH_MANAGER } from '@/core/connections/oauth-manager'
import { getConnectionCatalog } from '@/core/connections/connection-catalog'
import {
  saveConnection,
  startConnectionOAuth
} from '@/core/connections/connection-service'

import {
  handleConnectionSetup,
  type ConnectionSetupInput
} from '@/core/connections/connection-setup'

interface SaveConnectionBody {
  auth_type: 'api_key' | 'oauth'
  credentials: Record<string, unknown>
}

interface StartOAuthBody {
  return_url?: string
  client_id?: string
  client_secret?: string
}

function getCallbackOrigin(request: FastifyRequest): string {
  return new URL(`${request.protocol}://${request.host}`).origin
}

/**
 * Profile-authenticated connection management API. Secret values are accepted
 * only on writes and never included in read responses.
 */
export const connectionsPlugin: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  const route = `/api/${options.apiVersion}/connections`

  fastify.post<{
    Params: { provider: string }
    Body: Pick<
      ConnectionSetupInput,
      | 'action'
      | 'method'
      | 'state'
      | 'credentials'
      | 'session_id'
      | 'return_url'
      | 'authorization_failed'
    >
  }>(
    `${route}/:provider/setup`,
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['action', 'session_id'],
          properties: {
            action: { type: 'string' },
            method: { type: 'string' },
            session_id: { type: 'string', minLength: 1 },
            return_url: { type: 'string', format: 'uri' },
            authorization_failed: { type: 'boolean' },
            state: {
              type: 'object',
              additionalProperties: false,
              required: ['method', 'step'],
              properties: {
                method: { type: 'string' },
                step: { type: 'string' }
              }
            },
            credentials: {
              type: 'object',
              additionalProperties: { type: 'string' }
            }
          }
        }
      }
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      try {
        return reply.send(
          await handleConnectionSetup({
            ...request.body,
            provider: request.params.provider,
            callback_origin: getCallbackOrigin(request),
            api_version: options.apiVersion
          })
        )
      } catch {
        // Do not reflect credential validation or transport internals into responses.
        return reply
          .status(400)
          .send({ success: false, code: 'connection_setup_failed' })
      }
    }
  )

  fastify.post<{ Params: { provider: string }, Body: StartOAuthBody }>(
    `${route}/:provider/oauth/start`,
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            return_url: { type: 'string', format: 'uri' },
            client_id: { type: 'string', minLength: 1 },
            client_secret: { type: 'string', minLength: 1 }
          }
        }
      }
    },
    async (request, reply) => {
      try {
        const origin = getCallbackOrigin(request)
        const result = await startConnectionOAuth({
          provider: request.params.provider,
          callbackOrigin: origin,
          returnURL:
            request.body?.return_url ||
            String(request.headers.origin || origin),
          apiVersion: options.apiVersion,
          ...(request.body?.client_id
            ? { clientId: request.body.client_id }
            : {}),
          ...(request.body?.client_secret
            ? { clientSecret: request.body.client_secret }
            : {})
        })

        return reply.send({ success: true, ...result })
      } catch (error) {
        return reply
          .status(400)
          .send({ success: false, message: (error as Error).message })
      }
    }
  )

  fastify.get<{
    Querystring: { state?: string, code?: string, error?: string }
  }>(`${route}/oauth/callback`, async (request, reply) => {
    const state = request.query.state || ''

    if (request.query.error) {
      const returnURL = OAUTH_MANAGER.cancelAuthorization(state)

      if (returnURL) {
        return reply.redirect(returnURL)
      }
    }

    if (!state || !request.query.code) {
      return reply.status(400).send({
        success: false,
        status: 400,
        code: 'oauth_callback_invalid',
        message: 'The provider returned an incomplete authorization response.'
      })
    }

    try {
      const result = await OAUTH_MANAGER.completeAuthorization({
        state,
        code: request.query.code
      })

      return reply.redirect(result.return_url)
    } catch {
      const returnURL = OAUTH_MANAGER.cancelAuthorization(state)

      if (returnURL) {
        const failedURL = new URL(returnURL)

        failedURL.searchParams.set('connection_result', 'failed')

        return reply.redirect(failedURL.toString())
      }

      return reply.status(400).send({
        success: false,
        status: 400,
        code: 'oauth_callback_expired',
        message: 'This authorization request expired. Start again from Leon.'
      })
    }
  })

  fastify.get(route, async (request, reply) => {
    const origin = getCallbackOrigin(request)

    reply.send({
      success: true,
      status: 200,
      code: 'connections_listed',
      connections: await CONNECTION_STORE.list(),
      tools: getConnectionCatalog({ origin, apiVersion: options.apiVersion })
    })
  })

  fastify.put<{ Params: { provider: string }, Body: SaveConnectionBody }>(
    `${route}/:provider`,
    async (request, reply) => {
      const { auth_type, credentials } = request.body || {}

      if (
        (auth_type !== 'api_key' && auth_type !== 'oauth') ||
        !credentials ||
        typeof credentials !== 'object' ||
        Array.isArray(credentials)
      ) {
        reply.status(400).send({
          success: false,
          status: 400,
          code: 'invalid_connection_payload',
          message: 'Provide auth_type and a credentials object.'
        })

        return
      }

      try {
        const connection = await saveConnection({
          provider: request.params.provider,
          auth_type,
          credentials
        })

        return reply.send({
          success: true,
          status: 200,
          code: 'connection_saved',
          connection
        })
      } catch (error) {
        return reply
          .status(400)
          .send({ success: false, message: (error as Error).message })
      }
    }
  )

  fastify.delete<{ Params: { provider: string } }>(
    `${route}/:provider`,
    async (request, reply) => {
      const removed = await CONNECTION_STORE.remove(request.params.provider)

      reply.send({
        success: true,
        status: 200,
        code: removed ? 'connection_removed' : 'connection_not_found',
        removed
      })
    }
  )
}
