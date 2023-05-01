import type { onRequestHookHandler } from 'fastify'

import { HOST, IS_PRODUCTION_ENV } from '@/constants'

export const corsMidd: onRequestHookHandler = async (_request, reply) => {
  // Allow only a specific client to request to the API (depending on the env)
  if (!IS_PRODUCTION_ENV) {
    reply.header('Access-Control-Allow-Origin', `${HOST}:3000`)
  }

  // Allow several headers for our requests
  reply.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  )

  reply.header('Access-Control-Allow-Credentials', true)
}
