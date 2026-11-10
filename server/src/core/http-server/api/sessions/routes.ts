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
import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import { searchConversationSessions } from '@/core/session-manager/session-search'
import { MAXIMUM_ARCHIVE_PAGE_CHARACTERS } from '@@/bridges/runtime/contracts/conversation-archive'
import type { MessageLog } from '@/types'
import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { TOOL_EXECUTION_MANAGER, ToolExecutionState } from '@/core/tool-manager/tool-execution-manager'
import { PreparationStatus } from '@@/aurora/src/v2/contracts/preparation'
import { TOOLKIT_REGISTRY } from '@/core'
import { ConversationHistoryHelper } from '@/helpers/conversation-history-helper'

const SESSION_ID_PARAM_NAME = 'session_id'

/**
 * Projects current display metadata and retained worker state without modifying
 * stored history. Reads only in-memory services, never starts a model or polls.
 */
function projectSessionMessage(sessionId: string, record: MessageLog): MessageLog {
  if (record.agentResponseTrace) {
    record = { ...record, agentResponseTrace: ConversationHistoryHelper.resolveAgentTraceToolIcons(
      record.agentResponseTrace, (name) => {
        const [toolkitId, toolId] = name.split('.')
        const toolLogo = toolkitId && toolId ? TOOLKIT_REGISTRY.getToolIconLogo(toolkitId, toolId) : undefined

        return toolLogo ? { toolLogo } : null
      }
    ) }
  }
  if (!record.agentResponseTrace?.toolCalls.some((call) => call.preparation?.executionId && call.status === 'running')) {
    return record
  }

  return { ...record, agentResponseTrace: { ...record.agentResponseTrace,
    toolCalls: record.agentResponseTrace.toolCalls.map((call) => {
      if (!call.preparation?.executionId || call.status !== 'running') {
        return call
      }
      let state: ToolExecutionState | undefined
      try {
        state = TOOL_EXECUTION_MANAGER.read(getActiveProfileName(), sessionId, call.preparation.executionId).execution.state
      } catch {
        // Missing handles include interrupted hosts and expired retained work.
      }
      if (state === ToolExecutionState.Running) {
        return call
      }
      const ready = call.preparation.status === PreparationStatus.Ready || state === ToolExecutionState.Completed

      return { ...call, status: state === ToolExecutionState.Completed ? 'success' as const : 'error' as const,
        preparation: { ...call.preparation, status: ready ? PreparationStatus.Ready
          : state === ToolExecutionState.Canceled ? PreparationStatus.Cancelled : PreparationStatus.Failed,
        detail: ready ? 'The required files are ready.' : state === ToolExecutionState.Canceled
          ? 'The preparation was cancelled.' : 'This preparation is no longer active. You can ask me to try again.' } }
    }) } }
}

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
const archiveSearchBodySchema = Type.Object({
  query: Type.String({ minLength: 1 }),
  role: Type.Optional(Type.Union([
    Type.Literal('owner'), Type.Literal('leon'), Type.Literal('both')
  ])),
  topK: Type.Optional(Type.Number()),
  contextWindow: Type.Optional(Type.Number()),
  includeCurrentSession: Type.Optional(Type.Boolean()),
  currentSessionId: Type.Optional(Type.String())
}, { additionalProperties: false })
const archiveReadQuerySchema = Type.Object({
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER - 1 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAXIMUM_ARCHIVE_PAGE_CHARACTERS }))
}, { additionalProperties: false })
const archiveSessionQuerySchema = Type.Object({
  cursor: Type.Optional(Type.String({ maxLength: 512 })),
  limit: archiveReadQuerySchema.properties.limit,
  role: archiveSearchBodySchema.properties.role
}, { additionalProperties: false })
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
  fastify.post<{ Body: Static<typeof archiveSearchBodySchema> }>(
    `/api/${options.apiVersion}/sessions/search`,
    { schema: { body: archiveSearchBodySchema } },
    async (request, reply) => {
      // Initializing the owning repository imports legacy history with stable message IDs.
      CONVERSATION_REPOSITORY.hasSessions()
      const data = await searchConversationSessions({
        ...request.body,
        sessionsPath: getProfilePaths().sessions
      })

      return reply.send({ success: true, data })
    }
  )

  fastify.get<{
    Params: { session_id: string, message_id: string }
    Querystring: Static<typeof archiveReadQuerySchema>
  }>(`/api/${options.apiVersion}/sessions/:session_id/messages/:message_id/text`, {
    schema: {
      params: Type.Object({ session_id: Type.String(), message_id: Type.String() }),
      querystring: archiveReadQuerySchema
    }
  }, async (request, reply) => {
    try {
      const data = CONVERSATION_REPOSITORY.readMessageText(
        request.params.session_id, request.params.message_id, request.query
      )

      return data
        ? reply.send({ success: true, data })
        : reply.code(404).send({ success: false, message: 'Visible message not found.' })
    } catch (error) {
      return reply.code(400).send({ success: false, message: String(error) })
    }
  })

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
          ...(page.searchMatches ? { search_matches: page.searchMatches } : {}),
          event_cursor: CONVERSATION_REPOSITORY.getReplayBounds().latest
        })
      } catch (error) {
        return reply.code(400).send({ success: false, message: String(error) })
      }
    }
  )

  fastify.get<{
    Params: Static<typeof sessionParamsSchema>
    Querystring: Static<typeof archiveSessionQuerySchema>
  }>(`/api/${options.apiVersion}/sessions/:${SESSION_ID_PARAM_NAME}/text`, {
    schema: { params: sessionParamsSchema, querystring: archiveSessionQuerySchema }
  }, async (request, reply) => {
    try {
      const data = CONVERSATION_REPOSITORY.readSessionText(
        request.params.session_id, request.query
      )

      return data
        ? reply.send({ success: true, data })
        : reply.code(404).send({ success: false, message: 'Conversation not found.' })
    } catch (error) {
      return reply.code(400).send({ success: false, message: String(error) })
    }
  })

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
        messages: snapshot.messages.items.map((record) => projectSessionMessage(sessionId, record)),
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
        ? reply.send({ success: true, message: projectSessionMessage(sessionId, message) })
        : reply.code(404).send({ success: false, message: 'Message not found.' })
    }
  )

  fastify.get<{
    Params: { session_id: string, message_id: string, tool_id: string }
    Querystring: { complete?: boolean }
  }>(`/api/${options.apiVersion}/sessions/:session_id/messages/:message_id/tools/:tool_id`, {
    schema: {
      params: Type.Object({ session_id: Type.String(), message_id: Type.String(), tool_id: Type.String() }),
      querystring: Type.Object({ complete: Type.Optional(Type.Boolean()) })
    }
  }, async (request, reply) => {
    const { session_id: sessionId, message_id: messageId, tool_id: toolId } = request.params
    if (!CONVERSATION_REPOSITORY.readSession(sessionId)) {
      return reply.code(404).send({ message: 'Session not found.' })
    }

    const contents = CONVERSATION_REPOSITORY.readToolContents(sessionId, messageId, toolId, request.query.complete)

    return contents ? reply.send(contents) : reply.code(404).send({ message: 'Tool call not found.' })
  })

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
