import type { FastifyPluginAsync } from 'fastify'

import type { APIOptions } from '@/core/http-server/http-server'
import { BRAIN, NLU } from '@/core'
import { LogHelper } from '@/helpers/log-helper'
import { NLUProcessResultUpdater } from '@/core/nlp/nlu/nlu-process-result-updater'

export const fetchWidget: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  fastify.route({
    method: 'GET',
    url: `/api/${options.apiVersion}/fetch-widget`,
    handler: async (_request, reply) => {
      let message

      try {
        const queryParams = _request.query as Record<string, string>
        const { skill_action: skillAction, widget_id: widgetId } = queryParams

        if (!skillAction || !widgetId) {
          reply.statusCode = 400
          message = 'skill_action and widget_id are missing.'
          LogHelper.title('GET /fetch-widget')
          LogHelper.warning(message)
          return reply.send({
            success: false,
            status: reply.statusCode,
            code: 'missing_params',
            message,
            widget: null
          })
        }

        const [skill, action] = skillAction.split(':')

        if (!skill || !action) {
          message = 'skill_action is not well formatted.'
          LogHelper.title('GET /fetch-widget')
          LogHelper.warning(message)
          return reply.send({
            success: false,
            status: reply.statusCode,
            code: 'skill_action_not_valid',
            message,
            widget: null
          })
        }

        // Do not return any speech and new widget
        BRAIN.isMuted = true

        await NLUProcessResultUpdater.update({
          skillName: skill
        })
        await NLUProcessResultUpdater.update({
          actionName: action
        })
        await NLUProcessResultUpdater.update({
          new: {
            entities: [
              {
                start: 0,
                end: widgetId.length - 1,
                len: widgetId.length,
                levenshtein: 0,
                accuracy: 1,
                entity: 'widgetid',
                type: 'enum',
                option: widgetId,
                sourceText: widgetId,
                utteranceText: widgetId,
                resolution: {
                  value: widgetId
                }
              }
            ]
          }
        })

        const processedData = await BRAIN.runSkillAction(NLU.nluProcessResult)

        console.log('processedData', processedData)

        if (processedData.lastOutputFromSkill?.widget) {
          console.log(
            'processedData.lastOutputFromSkill.widget',
            processedData.lastOutputFromSkill.widget
          )

          message = 'Widget fetched successfully.'
          LogHelper.title('GET /fetch-widget')
          LogHelper.success(message)
          return reply.send({
            success: true,
            status: 200,
            code: 'widget_fetched',
            message,
            widget: processedData.lastOutputFromSkill.widget
          })
        }

        message = 'Widget not fetched.'
        LogHelper.title('GET /fetch-widget')
        LogHelper.success(message)
        return reply.send({
          success: true,
          status: 200,
          code: 'widget_not_fetched',
          message,
          widget: null
        })
      } catch (e) {
        LogHelper.title('HTTP Server')
        LogHelper.error(`Failed to fetch widget component tree: ${e}`)

        reply.statusCode = 500
        return reply.send({
          success: false,
          status: reply.statusCode,
          code: 'fetch_widget_error',
          message: 'Failed to fetch widget component tree.',
          widget: null
        })
      }
    }
  })
}
