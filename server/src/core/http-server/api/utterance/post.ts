import type { FastifyPluginAsync, FastifySchema } from 'fastify'
import { Type } from '@sinclair/typebox'
import type { Static } from '@sinclair/typebox'

import { NLU, BRAIN } from '@/core'
import type { APIOptions } from '@/core/http-server/http-server'

const postUtteranceSchema = {
  body: Type.Object({
    utterance: Type.String()
  })
} satisfies FastifySchema

interface PostUtteranceSchema {
  body: Static<typeof postUtteranceSchema.body>
}

export const postUtterance: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  fastify.route<{
    Body: PostUtteranceSchema['body']
  }>({
    method: 'POST',
    url: `/api/${options.apiVersion}/utterance`,
    schema: postUtteranceSchema,
    handler: async (request, reply) => {
      const { utterance } = request.body

      try {
        BRAIN.isMuted = true
        const data = await NLU.process(utterance)

        reply.send({
          ...data,
          success: true
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : error
        reply.statusCode = 500
        reply.send({
          message,
          success: false
        })
      }
    }
  })
}
