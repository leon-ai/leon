import type { FastifyPluginAsync } from 'fastify'

import { postUtterance } from '@/core/http-server/api/utterance/post'
import type { APIOptions } from '@/core/http-server/http-server'

export const utterancePlugin: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  await fastify.register(postUtterance, options)
}
