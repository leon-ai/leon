import type { FastifyPluginAsync } from 'fastify'

import { getInfo } from '@/core/http-server/api/info/get'
import type { APIOptions } from '@/core/http-server/http-server'

export const infoPlugin: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  // Get information to init client
  await fastify.register(getInfo, options)
}
