import type { FastifyPluginAsync } from 'fastify'

import { postInference } from '@/core/http-server/api/inference/post'
import { providerRequestsPlugin } from './provider-requests'
import type { APIOptions } from '@/core/http-server/http-server'

export const inferencePlugin: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  await fastify.register(postInference, options)
  await fastify.register(providerRequestsPlugin, options)
}
