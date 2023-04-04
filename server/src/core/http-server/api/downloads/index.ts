import type { FastifyPluginAsync } from 'fastify'

import type { APIOptions } from '@/core/http-server/http-server'
import { getDownloads } from '@/core/http-server/api/downloads/get'

export const downloadsPlugin: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  // Get downloads to download skill content
  await fastify.register(getDownloads, options)
}
