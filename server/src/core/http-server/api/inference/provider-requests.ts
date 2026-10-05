import type { FastifyPluginAsync } from 'fastify'
import { Type } from '@sinclair/typebox'

import type { APIOptions } from '@/core/http-server/http-server'
import { CONFIG_STATE } from '@/core/config-states/config-state'
import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'
import { runWithConversationSession } from '@/core/session-manager/session-context'
import { requestProvider } from '@/core/llm-manager/provider-requests'
import { LLMProviders } from '@/core/llm-manager/types'
import { DateHelper } from '@/helpers/date-helper'

interface ProviderRequestBody {
  provider: LLMProviders
  endpoint: string
  payload: Record<string, unknown>
  headers?: Record<string, string>
  anthropicCompatibility?: boolean
}

/**
 * Lets ordinary tools use profile-owned provider connections without receiving secrets.
 */
export const providerRequestsPlugin: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  const root = `/api/${options.apiVersion}/inference`
  fastify.get<{ Querystring: { session_id?: string } }>(
    `${root}/target`,
    { schema: { querystring: Type.Object({ session_id: Type.Optional(Type.String()) }) } },
    async (request) => {
      const sessionId = request.query.session_id
      const session = sessionId
        ? CONVERSATION_SESSION_MANAGER.getSession(sessionId)
        : null
      if (sessionId && !session) {
        throw new Error('Conversation session does not exist.')
      }
      const target = runWithConversationSession(
        {
          sessionId: sessionId || '',
          ...(session?.modelTarget ? { modelTarget: session.modelTarget } : {})
        },
        () => {
          const models = CONFIG_STATE.getModelState()
          return CONFIG_STATE.getRoutingModeState().getRoutingMode() === 'agent'
            ? models.getAgentTarget()
            : models.getWorkflowTarget()
        }
      )

      return {
        provider: target.provider,
        model: target.model,
        currentDateTime: DateHelper.getDateTime()
      }
    }
  )
  fastify.post<{ Body: ProviderRequestBody }>(
    `${root}/provider-request`,
    {
      schema: {
        body: Type.Object({
          provider: Type.Enum(LLMProviders),
          endpoint: Type.String({ minLength: 1 }),
          payload: Type.Record(Type.String(), Type.Unknown()),
          headers: Type.Optional(Type.Record(Type.String(), Type.String())),
          anthropicCompatibility: Type.Optional(Type.Boolean())
        }, { additionalProperties: false })
      }
    },
    async (request, reply) => {
      const controller = new AbortController()
      const abort = (): void => {
        if (!reply.raw.writableEnded) {
          controller.abort()
        }
      }
      reply.raw.once('close', abort)
      try {
        const response = await requestProvider(
          request.body.provider,
          request.body.endpoint,
          request.body.payload,
          {
            signal: controller.signal,
            ...(request.body.headers ? { headers: request.body.headers } : {}),
            ...(request.body.anthropicCompatibility
              ? { anthropicCompatibility: true }
              : {})
          }
        )
        return await response.json()
      } finally {
        reply.raw.removeListener('close', abort)
      }
    }
  )
}
