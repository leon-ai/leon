import type { FastifyPluginAsync, FastifySchema } from 'fastify'
import { Type } from '@sinclair/typebox'
import type { Static } from '@sinclair/typebox'

import { BUILT_IN_COMMAND_MANAGER } from '@/built-in-command'
import type { APIOptions } from '@/core/http-server/http-server'

const COMMAND_MODES = ['autocomplete', 'execute'] as const
const COMMAND_INPUT_SEPARATOR_PATTERN = /\s+/
const SKILL_COMMAND_NAME = 'skill'
const SKILL_ENABLE_SUBCOMMAND = 'enable'
const SKILL_DISABLE_SUBCOMMAND = 'disable'

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

function isSkillToggleCommand(rawInput: string): boolean {
  const [, subcommand = ''] = rawInput.trim().split(COMMAND_INPUT_SEPARATOR_PATTERN)

  return (
    subcommand === SKILL_ENABLE_SUBCOMMAND ||
    subcommand === SKILL_DISABLE_SUBCOMMAND
  )
}

async function refreshSkillListIfSkillToggleCommand(input: {
  mode: (typeof COMMAND_MODES)[number]
  commandName: string | null
  rawInput: string
  status: string | undefined
}): Promise<void> {
  if (
    input.mode !== 'execute' ||
    input.commandName !== SKILL_COMMAND_NAME ||
    input.status !== 'completed' ||
    !isSkillToggleCommand(input.rawInput)
  ) {
    return
  }

  const { LLM_MANAGER } = await import('@/core')

  await LLM_MANAGER.refreshSkillListContent()
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
        await refreshSkillListIfSkillToggleCommand({
          mode,
          commandName: data.session.command_name,
          rawInput: input,
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
