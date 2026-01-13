import type { FastifyPluginAsync } from 'fastify'

import type { APIOptions } from '@/core/http-server/http-server'
import { BRAIN, NLU } from '@/core'
import { LogHelper } from '@/helpers/log-helper'
import { NLUProcessResultUpdater } from '@/core/nlp/nlu/nlu-process-result-updater'

export const runAction: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  fastify.route({
    method: 'POST',
    url: `/api/${options.apiVersion}/run-action`,
    handler: async (_request, reply) => {
      let message

      try {
        const bodyData = _request.body as Record<string, unknown>
        const { skill_action: actionName, action_params: actionParams } =
          bodyData

        if (!actionName || !actionParams) {
          reply.statusCode = 400
          message = 'skill_action and action_params are missing.'
          LogHelper.title('POST /run-action')
          LogHelper.warning(message)
          return reply.send({
            success: false,
            status: reply.statusCode,
            code: 'missing_params',
            message,
            result: null
          })
        }

        const [skill, action] = (actionName as string).split(':')

        if (!skill || !action) {
          message = 'skill_action is not well formatted.'
          LogHelper.title('POST /run-action')
          LogHelper.warning(message)
          return reply.send({
            success: false,
            status: reply.statusCode,
            code: 'skill_action_not_valid',
            message,
            result: null
          })
        }

        await NLUProcessResultUpdater.update({
          skillName: skill
        })
        await NLUProcessResultUpdater.update({
          actionName: action
        })
        await NLUProcessResultUpdater.update({
          new: {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
            actionArguments: actionParams.action_arguments,
            ...actionParams
          }
        })

        // Ensure we can send response from the brain
        BRAIN.isMuted = false

        const processedData = await BRAIN.runSkillAction(NLU.nluProcessResult)

        if (processedData.lastOutputFromSkill) {
          message = 'Skill action executed successfully.'
          LogHelper.title('POST /run-action')
          LogHelper.success(message)
          return reply.send({
            success: true,
            status: 200,
            code: 'action_executed',
            message,
            result: processedData
          })
        }

        message = 'Skill action not executed.'
        LogHelper.title('POST /run-action')
        LogHelper.success(message)
        return reply.send({
          success: true,
          status: 200,
          code: 'action_not_executed',
          message,
          result: null
        })
      } catch (e) {
        LogHelper.title('HTTP Server')
        LogHelper.error(`Failed to execute skill action: ${e}`)

        reply.statusCode = 500
        return reply.send({
          success: false,
          status: reply.statusCode,
          code: 'run_action_error',
          message: 'Failed to execute skill action.',
          result: null
        })
      }
    }
  })
}
