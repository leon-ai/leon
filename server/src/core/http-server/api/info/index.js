import getInfo from '@/core/http-server/api/info/get'

const infoPlugin = async (fastify, options) => {
  // Get information to init client
  fastify.register(getInfo, options)
}

export default infoPlugin
