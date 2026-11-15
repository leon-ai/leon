import type { FastifyPluginAsync } from 'fastify'

import type { APIOptions } from '@/core/http-server/http-server'
import { sessionsRoutes } from '@/core/http-server/api/sessions/routes'
import { webSessionRoutes } from './web-routes'
import { ownerAttachmentRoutes } from './attachments'

export const sessionsPlugin: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  await fastify.register(sessionsRoutes, options)
  await fastify.register(webSessionRoutes, options)
  await fastify.register(ownerAttachmentRoutes, options)
}
