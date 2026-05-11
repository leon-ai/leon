import type { FastifyPluginAsync, FastifySchema } from 'fastify'
import { Type } from '@sinclair/typebox'
import type { Static } from '@sinclair/typebox'

import type { APIOptions } from '@/core/http-server/http-server'
import { CONVERSATION_LOGGER } from '@/core'
import { LogHelper } from '@/helpers/log-helper'
import { ConversationHistoryHelper } from '@/helpers/conversation-history-helper'

const getConversationHistorySchema = {
  querystring: Type.Object({
    supports_widgets: Type.Optional(Type.String()),
    nb_of_logs_to_load: Type.Optional(Type.String()),
    session_id: Type.Optional(Type.String())
  })
} satisfies FastifySchema

interface GetConversationHistorySchema {
  querystring: Static<typeof getConversationHistorySchema.querystring>
}

const TRUE_BOOLEAN_VALUES = ['1', 'true', 'yes']

function parseBooleanQuery(value?: string): boolean {
  if (!value) {
    return false
  }

  return TRUE_BOOLEAN_VALUES.includes(value.toLowerCase())
}

export const getConversationHistory: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  fastify.route<{
    Querystring: GetConversationHistorySchema['querystring']
  }>({
    method: 'GET',
    url: `/api/${options.apiVersion}/conversation-history`,
    schema: getConversationHistorySchema,
    handler: async (request, reply) => {
      try {
        const supportsWidgets = parseBooleanQuery(
          request.query.supports_widgets
        )
        const nbOfLogsToLoad = request.query.nb_of_logs_to_load
          ? Number(request.query.nb_of_logs_to_load)
          : null
        const sessionOptions = request.query.session_id
          ? { sessionId: request.query.session_id }
          : {}
        const rawConversationLogs = nbOfLogsToLoad && nbOfLogsToLoad > 0
          ? await CONVERSATION_LOGGER.load({
              nbOfLogsToLoad,
              ...sessionOptions
            })
          : await CONVERSATION_LOGGER.loadAll(sessionOptions)
        const conversationLogs = rawConversationLogs.filter(
          (conversationLog) => ConversationHistoryHelper.isAddedToHistory(conversationLog)
        )
        const history = ConversationHistoryHelper.toHistoryItems(
          conversationLogs,
          {
            supportsWidgets,
            source: 'conversation_history'
          }
        )

        LogHelper.title('GET /conversation-history')
        LogHelper.success('Conversation history fetched.')

        return reply.send({
          success: true,
          status: 200,
          code: 'conversation_history_fetched',
          message: 'Conversation history fetched.',
          history
        })
      } catch (error) {
        LogHelper.title('GET /conversation-history')
        LogHelper.error(`Failed to fetch conversation history: ${error}`)

        reply.statusCode = 500
        return reply.send({
          success: false,
          status: reply.statusCode,
          code: 'conversation_history_error',
          message: 'Failed to fetch conversation history.',
          history: []
        })
      }
    }
  })
}
