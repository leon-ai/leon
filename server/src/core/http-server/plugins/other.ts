import type { preValidationHookHandler } from 'fastify'

import { LogHelper } from '@/helpers/log-helper'

export const otherMidd: preValidationHookHandler = (request, reply) => {
  // Disable from the header, else it makes hacker's life easier to know more about our system
  reply.removeHeader('X-Powered-By')
  LogHelper.title('Requesting')
  LogHelper.info(`${request.method} ${request.url}`)
}
