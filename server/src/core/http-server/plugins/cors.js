import { HOST, IS_PRODUCTION_ENV } from '@/constants'

const corsMidd = async (request, reply) => {
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

export default corsMidd
