import type { FastifyPluginAsync, FastifySchema } from 'fastify'
import { Type } from '@sinclair/typebox'
import type { Static } from '@sinclair/typebox'

import { BUILT_IN_COMMAND_MANAGER } from '@/commands'
import type { APIOptions } from '@/core/http-server/http-server'

const COMMAND_MODES = ['autocomplete', 'execute'] as const

const postCommandSchema = {
  body: Type.Object({
    mode: Type.Union(COMMAND_MODES.map((mode) => Type.Literal(mode))),
    input: Type.String(),
    session_id: Type.Optional(Type.String())
  })
} satisfies FastifySchema

interface PostCommandSchema {
  body: Static<typeof postCommandSchema.body>
}

async function refreshLLMRuntimeIfModelCommand(input: {
  mode: (typeof COMMAND_MODES)[number]
  commandName: string | null
  status: string | undefined
}): Promise<void> {
  if (
    input.mode !== 'execute' ||
    input.commandName !== 'model' ||
    input.status !== 'completed'
  ) {
    return
  }

  const { LLM_PROVIDER, LLM_MANAGER } = await import('@/core')
  const isProviderReady = await LLM_PROVIDER.init()

  if (isProviderReady) {
    await LLM_MANAGER.init()
  }
}

export const postCommand: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  fastify.route<{
    Body: PostCommandSchema['body']
  }>({
    method: 'POST',
    url: `/api/${options.apiVersion}/command`,
    schema: postCommandSchema,
    handler: async (request, reply) => {
      const { mode, input, session_id: sessionId } = request.body

      try {
        const data =
          mode === 'autocomplete'
            ? BUILT_IN_COMMAND_MANAGER.autocomplete(input, sessionId)
            : await BUILT_IN_COMMAND_MANAGER.execute(input, sessionId)

        await refreshLLMRuntimeIfModelCommand({
          mode,
          commandName: data.session.command_name,
          status: 'status' in data ? data.status : undefined
        })

        reply.send({
          ...data,
          success: true
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        reply.statusCode = 500
        reply.send({
          success: false,
          message
        })
      }
    }
  })
}
