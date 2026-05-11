import type { FastifyPluginAsync } from 'fastify'

import type { APIOptions } from '@/core/http-server/http-server'
import { sessionsRoutes } from '@/core/http-server/api/sessions/routes'

export const sessionsPlugin: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  await fastify.register(sessionsRoutes, options)
}
