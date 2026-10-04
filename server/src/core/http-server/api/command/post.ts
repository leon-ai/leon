import type { FastifyPluginAsync, FastifySchema } from 'fastify'
import { Type } from '@sinclair/typebox'
import type { Static } from '@sinclair/typebox'

import { BUILT_IN_COMMAND_MANAGER } from '@/built-in-command'
import type { APIOptions } from '@/core/http-server/http-server'
import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'
import { refreshActiveProfileLLMRuntime } from '@/core/profile-runtime/initialize-profile-runtime'
import {
  CONNECTION_COMMAND_NAME,
  AI_CONNECTION_SCOPE,
  AI_CONNECTION_MUTATION_ACTIONS
} from '@/built-in-command/commands/connection-command/connection-command'

const COMMAND_MODES = ['autocomplete', 'execute'] as const
const COMMAND_INPUT_SEPARATOR_PATTERN = /\s+/
const SKILL_COMMAND_NAME = 'skill'
const SKILL_ENABLE_SUBCOMMAND = 'enable'
const SKILL_DISABLE_SUBCOMMAND = 'disable'
const SKILL_ALLOW_ONLY_SUBCOMMAND = 'allow-only'
const SKILL_REMOVE_ALLOW_ONLY_SUBCOMMAND = 'remove-allow-only'
const TOOL_COMMAND_NAME = 'tool'
const TOOL_ENABLE_SUBCOMMAND = 'enable'
const TOOL_DISABLE_SUBCOMMAND = 'disable'
const TOOL_ALLOW_ONLY_SUBCOMMAND = 'allow-only'
const TOOL_REMOVE_ALLOW_ONLY_SUBCOMMAND = 'remove-allow-only'

const postCommandSchema = {
  body: Type.Object({
    mode: Type.Union(COMMAND_MODES.map((mode) => Type.Literal(mode))),
    input: Type.String(),
    session_id: Type.Optional(Type.String()),
    conversation_session_id: Type.Optional(Type.String())
  })
} satisfies FastifySchema

interface PostCommandSchema {
  body: Static<typeof postCommandSchema.body>
}

async function refreshLLMRuntimeIfConfigurationCommand(input: {
  mode: (typeof COMMAND_MODES)[number]
  commandName: string | null
  status: string | undefined
  rawInput: string
}): Promise<void> {
  const [, scope, action, argument] = input.rawInput.trim().toLowerCase().split(COMMAND_INPUT_SEPARATOR_PATTERN)
  const isAIConnectionMutation = input.commandName === CONNECTION_COMMAND_NAME &&
    scope === AI_CONNECTION_SCOPE &&
    !!argument &&
    AI_CONNECTION_MUTATION_ACTIONS.some((candidate) => candidate === action)

  if (
    input.mode !== 'execute' ||
    (input.commandName !== 'model' && !isAIConnectionMutation) ||
    input.status !== 'completed'
  ) {
    return
  }

  await refreshActiveProfileLLMRuntime()
}

function isSkillToggleCommand(rawInput: string): boolean {
  const [, subcommand = ''] = rawInput.trim().split(COMMAND_INPUT_SEPARATOR_PATTERN)

  return (
    subcommand === SKILL_ENABLE_SUBCOMMAND ||
    subcommand === SKILL_DISABLE_SUBCOMMAND ||
    subcommand === SKILL_ALLOW_ONLY_SUBCOMMAND ||
    subcommand === SKILL_REMOVE_ALLOW_ONLY_SUBCOMMAND
  )
}

function isToolToggleCommand(rawInput: string): boolean {
  const [, subcommand = ''] = rawInput.trim().split(COMMAND_INPUT_SEPARATOR_PATTERN)

  return (
    subcommand === TOOL_ENABLE_SUBCOMMAND ||
    subcommand === TOOL_DISABLE_SUBCOMMAND ||
    subcommand === TOOL_ALLOW_ONLY_SUBCOMMAND ||
    subcommand === TOOL_REMOVE_ALLOW_ONLY_SUBCOMMAND
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

async function refreshToolkitRegistryIfToolToggleCommand(input: {
  mode: (typeof COMMAND_MODES)[number]
  commandName: string | null
  rawInput: string
  status: string | undefined
}): Promise<void> {
  if (
    input.mode !== 'execute' ||
    input.commandName !== TOOL_COMMAND_NAME ||
    input.status !== 'completed' ||
    !isToolToggleCommand(input.rawInput)
  ) {
    return
  }

  const { TOOLKIT_REGISTRY } = await import('@/core')

  await TOOLKIT_REGISTRY.reload()
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
      const {
        mode,
        input,
        session_id: sessionId,
        conversation_session_id: conversationSessionId
      } = request.body

      try {
        const activeSessionId =
          conversationSessionId ||
          CONVERSATION_SESSION_MANAGER.getActiveSessionId()
        // Autocomplete is read-only and must stay responsive while an agent turn
        // holds the conversation session queue. Executions remain ordered.
        const data =
          mode === 'autocomplete'
            ? BUILT_IN_COMMAND_MANAGER.autocomplete(input, sessionId)
            : await CONVERSATION_SESSION_MANAGER.runWithSession(
                activeSessionId,
                () => BUILT_IN_COMMAND_MANAGER.execute(input, sessionId)
              )

        await refreshLLMRuntimeIfConfigurationCommand({
          mode,
          commandName: data.session.command_name,
          rawInput: data.session.raw_input,
          status: 'status' in data ? data.status : undefined
        })
        await refreshSkillListIfSkillToggleCommand({
          mode,
          commandName: data.session.command_name,
          rawInput: input,
          status: 'status' in data ? data.status : undefined
        })
        await refreshToolkitRegistryIfToolToggleCommand({
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
