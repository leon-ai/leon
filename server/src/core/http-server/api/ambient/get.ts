import type { FastifyPluginAsync } from 'fastify'

import { AMBIENT_CONDITIONS_MANAGER, PERSONA } from '@/core'
import type { APIOptions } from '@/core/http-server/http-server'
import { LogHelper } from '@/helpers/log-helper'

export const getAmbientConditions: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  fastify.route({
    method: 'GET',
    url: `/api/${options.apiVersion}/ambient`,
    handler: async (_request, reply) => {
      const ambient = await AMBIENT_CONDITIONS_MANAGER.getSnapshot()

      LogHelper.title('GET /ambient')
      LogHelper.success('Ambient conditions fetched.')

      return reply.send({
        success: true,
        status: 200,
        code: 'ambient_conditions_fetched',
        message: 'Ambient conditions fetched.',
        ambient: { ...ambient, mood: PERSONA.mood.type }
      })
    }
  })
}
