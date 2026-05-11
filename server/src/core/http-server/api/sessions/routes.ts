import type { FastifyPluginAsync, FastifySchema } from 'fastify'
import { Type } from '@sinclair/typebox'
import type { Static } from '@sinclair/typebox'

import type { APIOptions } from '@/core/http-server/http-server'
import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'
import { CONFIG_STATE } from '@/core/config-states/config-state'
import { LogHelper } from '@/helpers/log-helper'

const SESSION_ID_PARAM_NAME = 'session_id'

const sessionParamsSchema = Type.Object({
  [SESSION_ID_PARAM_NAME]: Type.String()
})

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

  fastify.route({
    method: 'POST',
    url: `/api/${options.apiVersion}/sessions`,
    handler: async (_request, reply) => {
      const session = CONVERSATION_SESSION_MANAGER.createSession()

      LogHelper.title('POST /sessions')
      LogHelper.success('Session created.')

      return reply.send({
        success: true,
        status: 200,
        code: 'session_created',
        message: 'Session created.',
        session,
        ...toSessionsPayload()
      })
    }
  })

  fastify.route<{
    Params: UpdateSessionSchema['params']
    Body: UpdateSessionSchema['body']
  }>({
    method: 'PATCH',
    url: `/api/${options.apiVersion}/sessions/:${SESSION_ID_PARAM_NAME}`,
    schema: updateSessionSchema,
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
        ...toSessionsPayload()
      })
    }
  })

  fastify.route<{
    Params: DeleteSessionSchema['params']
  }>({
    method: 'DELETE',
    url: `/api/${options.apiVersion}/sessions/:${SESSION_ID_PARAM_NAME}`,
    schema: deleteSessionSchema,
    handler: async (request, reply) => {
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
        ...toSessionsPayload()
      })
    }
  })
}
