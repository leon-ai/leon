import { exec } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { type FastifyPluginAsync } from 'fastify'

import { LogHelper } from '@/helpers/log-helper'

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

        const resolvedPath = path.resolve(filePath)

        if (!fs.existsSync(resolvedPath)) {
          return reply.code(404).send({
            success: false,
            error: 'Path does not exist'
          })
        }

        let command = ''
        const platform = process.platform

        if (platform === 'win32') {
          command = `explorer /select,"${resolvedPath}"`
        } else if (platform === 'darwin') {
          command = fs.lstatSync(resolvedPath).isDirectory()
            ? `open "${resolvedPath}"`
            : `open -R "${resolvedPath}"`
        } else if (platform === 'linux') {
          const isDirectory = fs.lstatSync(resolvedPath).isDirectory()
          command = isDirectory
            ? `xdg-open "${resolvedPath}"`
            : `xdg-open "${path.dirname(resolvedPath)}"`
        } else {
          return reply.code(400).send({
            success: false,
            error: 'Unsupported operating system'
          })
        }

        exec(command, (error) => {
          if (error) {
            LogHelper.error(`Failed to open path: ${error.message}`)
            reply.code(500).send({
              success: false,
              error: 'Failed to open path'
            })
            return
          }

          reply.send({
            success: true,
            message: 'Path opened successfully'
          })
        })
      } catch (error) {
        LogHelper.error(
          `Error in open-path endpoint: ${(error as Error).message}`
        )
        reply.code(500).send({
          success: false,
          error: 'Internal server error'
        })
      }
    }
  )
}

export default openPath
