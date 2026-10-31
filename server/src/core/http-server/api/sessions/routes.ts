import type { FastifyPluginAsync, FastifySchema } from 'fastify'
import { Type } from '@sinclair/typebox'
import type { Static } from '@sinclair/typebox'

import type { APIOptions } from '@/core/http-server/http-server'
import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'
import { CONFIG_STATE } from '@/core/config-states/config-state'
import { CONVERSATION_REPOSITORY } from '@/core/session-manager/conversation-repository'
import { LogHelper } from '@/helpers/log-helper'
import { WEB_SESSION_RUNTIME } from '@/core/session-manager/web-session-runtime'
import { getSessionSelection } from './web-routes'

const SESSION_ID_PARAM_NAME = 'session_id'

const sessionParamsSchema = Type.Object({
  [SESSION_ID_PARAM_NAME]: Type.String()
})

const pageQuerySchema = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  cursor: Type.Optional(Type.String({ maxLength: 512 })),
  query: Type.Optional(Type.String({ maxLength: 256 }))
})

const historyQuerySchema = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  before: Type.Optional(Type.String({ maxLength: 32 })),
  after: Type.Optional(Type.String({ maxLength: 32 }))
})
const compactQuerySchema = Type.Object({ compact: Type.Optional(Type.Boolean()) })
const queryHistorySchema = Type.Object({
  limit: historyQuerySchema.properties.limit,
  before: historyQuerySchema.properties.before,
  characters: Type.Optional(Type.Integer({ minimum: 1 }))
})
const createSessionBodySchema = Type.Object({ id: Type.Optional(Type.String({ format: 'uuid' })) })

const updateSessionSchema = {
  params: sessionParamsSchema,
  body: Type.Object({
    title: Type.Optional(Type.String()),
    is_pinned: Type.Optional(Type.Boolean()),
    is_active: Type.Optional(Type.Boolean()),
    model_target: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    provider: Type.Optional(Type.String()),
    model: Type.Optional(Type.String())
  })
} satisfies FastifySchema

const deleteSessionSchema = {
  params: sessionParamsSchema
} satisfies FastifySchema

interface UpdateSessionSchema {
  params: Static<typeof updateSessionSchema.params>
  body: Static<typeof updateSessionSchema.body>
}

function mutationPayload(query: { compact?: boolean }): Record<string, unknown> {
  return query.compact ? {} : toSessionsPayload()
}

interface DeleteSessionSchema {
  params: Static<typeof deleteSessionSchema.params>
}

function toSessionsPayload(): Record<string, unknown> {
  const modelState = CONFIG_STATE.getModelState()

  return {
    active_session_id: CONVERSATION_SESSION_MANAGER.getActiveSessionId(),
    sessions: CONVERSATION_SESSION_MANAGER.listSessions(),
    supported_providers: modelState.getSupportedProviders(),
    current_model_target: modelState.getConfiguredTargetDisplay()
  }
}

export const sessionsRoutes: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  fastify.get<{ Querystring: Static<typeof pageQuerySchema> }>(
    `/api/${options.apiVersion}/sessions/page`,
    { schema: { querystring: pageQuerySchema } },
    async (request, reply) => {
      if (!CONVERSATION_REPOSITORY.hasSessions()) {
        CONVERSATION_SESSION_MANAGER.ensureReady()
      }
      try {
        const page = CONVERSATION_REPOSITORY.listSessions(request.query)

        return reply.send({
          success: true,
          sessions: page.items.map((session) => ({
            ...session,
            status: WEB_SESSION_RUNTIME.isRunning(session.id) ? 'wip' : 'idle'
          })),
          next_cursor: page.nextCursor,
          event_cursor: CONVERSATION_REPOSITORY.getReplayBounds().latest
        })
      } catch (error) {
        return reply.code(400).send({ success: false, message: String(error) })
      }
    }
  )

  fastify.get<{
    Params: Static<typeof sessionParamsSchema>
    Querystring: Static<typeof historyQuerySchema>
  }>(`/api/${options.apiVersion}/sessions/:${SESSION_ID_PARAM_NAME}`, {
    schema: { params: sessionParamsSchema, querystring: historyQuerySchema }
  }, async (request, reply) => {
    const sessionId = request.params[SESSION_ID_PARAM_NAME]
    const session = CONVERSATION_REPOSITORY.readSession(sessionId)
    if (!session) {
      return reply.code(404).send({ success: false, message: 'Session not found.' })
    }

    try {
      const snapshot = CONVERSATION_REPOSITORY.readSnapshot(sessionId, request.query)

      return reply.send({
        success: true,
        session,
        messages: snapshot.messages.items,
        next_cursor: snapshot.messages.nextCursor,
        newer_cursor: snapshot.messages.previousCursor ?? null,
        is_running: WEB_SESSION_RUNTIME.isRunning(sessionId),
        event_cursor: snapshot.eventCursor,
        command: snapshot.command,
        selection: getSessionSelection(session)
      })
    } catch (error) {
      return reply.code(400).send({ success: false, message: String(error) })
    }
  })

  fastify.get<{
    Params: Static<typeof sessionParamsSchema>
    Querystring: Static<typeof queryHistorySchema>
  }>(`/api/${options.apiVersion}/sessions/:${SESSION_ID_PARAM_NAME}/queries`, {
    schema: { params: sessionParamsSchema, querystring: queryHistorySchema }
  }, async (request, reply) => {
    const sessionId = request.params[SESSION_ID_PARAM_NAME]
    if (!CONVERSATION_REPOSITORY.readSession(sessionId)) {
      return reply.code(404).send({ success: false, message: 'Session not found.' })
    }

    try {
      const page = CONVERSATION_REPOSITORY.readQueryHistory(sessionId, request.query)

      return reply.send({ queries: page.items, next_cursor: page.nextCursor })
    } catch (error) {
      return reply.code(400).send({ success: false, message: String(error) })
    }
  })

  fastify.get<{ Params: { session_id: string, message_id: string } }>(
    `/api/${options.apiVersion}/sessions/:session_id/messages/:message_id`,
    { schema: { params: Type.Object({ session_id: Type.String(), message_id: Type.String() }) } },
    async (request, reply) => {
      const sessionId = request.params.session_id
      if (!CONVERSATION_REPOSITORY.readSession(sessionId)) {
        return reply.code(404).send({ success: false, message: 'Session not found.' })
      }

      const message = CONVERSATION_REPOSITORY.readMessage(sessionId, request.params.message_id)

      return message
        ? reply.send({ success: true, message })
        : reply.code(404).send({ success: false, message: 'Message not found.' })
    }
  )

  fastify.route({
    method: 'GET',
    url: `/api/${options.apiVersion}/sessions`,
    handler: async (_request, reply) => {
      LogHelper.title('GET /sessions')
      LogHelper.success('Sessions fetched.')

      return reply.send({
        success: true,
        status: 200,
        code: 'sessions_fetched',
        message: 'Sessions fetched.',
        ...toSessionsPayload()
      })
    }
  })

  fastify.route<{
    Querystring: Static<typeof compactQuerySchema>
    Body: Static<typeof createSessionBodySchema> | undefined
  }>({
    method: 'POST',
    url: `/api/${options.apiVersion}/sessions`,
    schema: { querystring: compactQuerySchema, body: Type.Optional(createSessionBodySchema) },
    handler: async (request, reply) => {
      const session = CONVERSATION_SESSION_MANAGER.createSession(request.body?.id)

      LogHelper.title('POST /sessions')
      LogHelper.success('Session created.')

      return reply.send({
        success: true,
        status: 200,
        code: 'session_created',
        message: 'Session created.',
        session,
        ...mutationPayload(request.query)
      })
    }
  })

  fastify.route<{
    Params: UpdateSessionSchema['params']
    Body: UpdateSessionSchema['body']
    Querystring: Static<typeof compactQuerySchema>
  }>({
    method: 'PATCH',
    url: `/api/${options.apiVersion}/sessions/:${SESSION_ID_PARAM_NAME}`,
    schema: { ...updateSessionSchema, querystring: compactQuerySchema },
    handler: async (request, reply) => {
      const sessionId = request.params[SESSION_ID_PARAM_NAME]

      if (request.body.is_active === true) {
        CONVERSATION_SESSION_MANAGER.setActiveSession(sessionId)
      }

      let session = CONVERSATION_SESSION_MANAGER.updateSession(sessionId, {
        ...(typeof request.body.title === 'string'
          ? { title: request.body.title }
          : {}),
        ...(typeof request.body.is_pinned === 'boolean'
          ? { isPinned: request.body.is_pinned }
          : {}),
        ...('model_target' in request.body
          ? { modelTarget: request.body.model_target || null }
          : {})
      })

      if (request.body.provider && request.body.model) {
        session = await CONVERSATION_SESSION_MANAGER.setSessionModelFromProvider(
          sessionId,
          request.body.provider,
          request.body.model
        )
      }

      LogHelper.title('PATCH /sessions')
      LogHelper.success('Session updated.')

      return reply.send({
        success: true,
        status: 200,
        code: 'session_updated',
        message: 'Session updated.',
        session,
        ...mutationPayload(request.query)
      })
    }
  })

  fastify.route<{
    Params: DeleteSessionSchema['params']
    Querystring: Static<typeof compactQuerySchema>
  }>({
    method: 'DELETE',
    url: `/api/${options.apiVersion}/sessions/:${SESSION_ID_PARAM_NAME}`,
    schema: { ...deleteSessionSchema, querystring: compactQuerySchema },
    handler: async (request, reply) => {
      await WEB_SESSION_RUNTIME.stop(request.params[SESSION_ID_PARAM_NAME])
      const session = CONVERSATION_SESSION_MANAGER.deleteSession(
        request.params[SESSION_ID_PARAM_NAME]
      )

      LogHelper.title('DELETE /sessions')
      LogHelper.success('Session deleted.')

      return reply.send({
        success: true,
        status: 200,
        code: 'session_deleted',
        message: 'Session deleted.',
        session,
        ...mutationPayload(request.query)
      })
    }
  })
}
