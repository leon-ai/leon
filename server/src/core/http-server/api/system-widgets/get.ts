import type { FastifyPluginAsync, FastifySchema } from 'fastify'
import { Type } from '@sinclair/typebox'
import type { Static } from '@sinclair/typebox'

import type { APIOptions } from '@/core/http-server/http-server'
import { CONVERSATION_LOGGER } from '@/core'
import { LogHelper } from '@/helpers/log-helper'
import { ConversationHistoryHelper } from '@/helpers/conversation-history-helper'

const getSystemWidgetsSchema = {
  querystring: Type.Object({
    supports_widgets: Type.Optional(Type.String()),
    session_id: Type.Optional(Type.String())
  })
} satisfies FastifySchema

interface GetSystemWidgetsSchema {
  querystring: Static<typeof getSystemWidgetsSchema.querystring>
}

const TRUE_BOOLEAN_VALUES = ['1', 'true', 'yes']

function parseBooleanQuery(value?: string): boolean {
  if (!value) {
    return false
  }

  return TRUE_BOOLEAN_VALUES.includes(value.toLowerCase())
}

export const getSystemWidgets: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  fastify.route<{
    Querystring: GetSystemWidgetsSchema['querystring']
  }>({
    method: 'GET',
    url: `/api/${options.apiVersion}/system-widgets`,
    schema: getSystemWidgetsSchema,
    handler: async (request, reply) => {
      try {
        const supportsWidgets = parseBooleanQuery(
          request.query.supports_widgets
        )
        const sessionOptions = request.query.session_id
          ? { sessionId: request.query.session_id }
          : {}
        const systemWidgetLogs = (
          await CONVERSATION_LOGGER.loadAll(sessionOptions)
        ).filter(
          (conversationLog) =>
            !ConversationHistoryHelper.isAddedToHistory(conversationLog) &&
            ConversationHistoryHelper.isSystemWidget(conversationLog.widget)
        )
        const widgets = ConversationHistoryHelper.toHistoryItems(
          systemWidgetLogs,
          {
            supportsWidgets,
            source: 'system_widget'
          }
        )

        LogHelper.title('GET /system-widgets')
        LogHelper.success('System widgets fetched.')

        return reply.send({
          success: true,
          status: 200,
          code: 'system_widgets_fetched',
          message: 'System widgets fetched.',
          widgets
        })
      } catch (error) {
        LogHelper.title('GET /system-widgets')
        LogHelper.error(`Failed to fetch system widgets: ${error}`)

        reply.statusCode = 500
        return reply.send({
          success: false,
          status: reply.statusCode,
          code: 'system_widgets_error',
          message: 'Failed to fetch system widgets.',
          widgets: []
        })
      }
    }
  })
}
