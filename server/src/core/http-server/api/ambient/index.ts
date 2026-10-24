import type { FastifyPluginAsync } from 'fastify'

import { getAmbientConditions } from '@/core/http-server/api/ambient/get'
import type { APIOptions } from '@/core/http-server/http-server'

export const ambientPlugin: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  await fastify.register(getAmbientConditions, options)
}
