import { type FastifyPluginAsync } from 'fastify'

import { LogHelper } from '@/helpers/log-helper'
import { FileHelper } from '@/helpers/file-helper'

const openPath: FastifyPluginAsync = async (fastify) => {
  fastify.post<{
    Body: {
      path: string
    }
  }>(
    '/api/v1/open-path',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            path: { type: 'string' }
          },
          required: ['path']
        }
      }
    },
    async (request, reply) => {
      try {
        const { path: filePath } = request.body

        if (!filePath || typeof filePath !== 'string') {
          return reply.code(400).send({
            success: false,
            error: 'Invalid path provided'
          })
        }

        await FileHelper.openPath(filePath)

        reply.send({
          success: true,
          message: 'Path opened successfully'
        })
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error)

        if (errorMessage === 'Path does not exist') {
          return reply.code(404).send({
            success: false,
            error: errorMessage
          })
        }

        if (errorMessage === 'Unsupported path type') {
          return reply.code(400).send({
            success: false,
            error: errorMessage
          })
        }

        LogHelper.error(
          `Error in open-path endpoint: ${errorMessage}`
        )
        reply.code(500).send({
          success: false,
          error: 'Failed to open path'
        })
      }
    }
  )
}

export default openPath
