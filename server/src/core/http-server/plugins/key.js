import { HTTP_API_KEY } from '@/constants'

const keyMidd = async (request, reply) => {
  const apiKey = request.headers['x-api-key']
  if (!apiKey || apiKey !== HTTP_API_KEY) {
    reply.statusCode = 401
    reply.send({
      message: 'Unauthorized, please check the HTTP API key is correct',
      success: false
    })
  }
}

export default keyMidd
