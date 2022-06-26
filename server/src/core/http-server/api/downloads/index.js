import getDownloads from '@/core/http-server/api/downloads/get'

const downloadsPlugin = async (fastify, options) => {
  // Get downloads to download skill content
  fastify.register(getDownloads, options)
}

export default downloadsPlugin
