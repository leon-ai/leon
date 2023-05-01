import type { preHandlerHookHandler } from 'fastify'

import { HTTP_API_KEY } from '@/constants'

export const keyMidd: preHandlerHookHandler = async (request, reply) => {
  const apiKey = request.headers['x-api-key']
  if (!apiKey || apiKey !== HTTP_API_KEY) {
    reply.statusCode = 401
    reply.send({
      message: 'Unauthorized, please check the HTTP API key is correct',
      success: false
    })
  }
}
