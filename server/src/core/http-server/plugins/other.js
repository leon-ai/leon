import { LOG } from '@/helpers/log'

const otherMidd = async (request, reply) => {
  // Disable from the header, else it makes hacker's life easier to know more about our system
  reply.removeHeader('X-Powered-By')
  LOG.title('Requesting')
  LOG.info(`${request.method} ${request.url}`)
}

export default otherMidd
