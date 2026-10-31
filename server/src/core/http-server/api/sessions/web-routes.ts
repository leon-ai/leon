import type { FastifyPluginAsync } from 'fastify'
import { Type } from '@sinclair/typebox'
import type { Static } from '@sinclair/typebox'

import type { APIOptions } from '@/core/http-server/http-server'
import { CONFIG_STATE } from '@/core/config-states/config-state'
import { getPublicModelCatalog } from '@/core/llm-manager/public-model-catalog'
import { LLM_MODEL_REASONING_VALUES, LLM_MODEL_SPEED_VALUES } from '@/core/llm-manager/llm-model-catalog'
import { subscribeAgentEvents } from '@/core/http-server/http-plugins/leon-services/agent-event-channel'
import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'
import { CONVERSATION_REPOSITORY } from '@/core/session-manager/conversation-repository'
import type { ConversationSession } from '@/core/session-manager'
import { WEB_SESSION_RUNTIME } from '@/core/session-manager/web-session-runtime'
import { runWithConversationSession } from '@/core/session-manager/session-context'
import type { LLMModelSettings } from '@/core/config-states/model-settings-state'

const HEARTBEAT_INTERVAL_MS = 15_000
const MAXIMUM_STREAM_BACKLOG_BYTES = 1_024 * 1_024
const sessionParams = Type.Object({ session_id: Type.String() })
const sendBody = Type.Object({
  id: Type.String({ format: 'uuid' }),
  query: Type.String({ minLength: 1, maxLength: 100_000 })
})
const modelBody = Type.Object({
  provider: Type.String(),
  model: Type.String(),
  reasoning: Type.Optional(Type.Union(LLM_MODEL_REASONING_VALUES.map((value) => Type.Literal(value)))),
  speed: Type.Optional(Type.Union(LLM_MODEL_SPEED_VALUES.map((value) => Type.Literal(value))))
})
const streamQuery = Type.Object({
  session_id: Type.Optional(Type.String()),
  after: Type.Optional(Type.Integer({ minimum: 0 }))
})

/**
 * Resolves the same session/profile/catalog precedence used at turn dispatch.
 */
export function getSessionSelection(session?: ConversationSession, targetValue?: string): {
  provider: string | null
  model: string
  target: string
  settings: LLMModelSettings
} {
  return runWithConversationSession({
    sessionId: session?.id ?? '',
    modelTarget: targetValue ?? session?.modelTarget ?? null
  }, () => {
    const target = CONFIG_STATE.getModelState().getAgentTarget()

    return {
      provider: target.provider,
      model: target.model,
      target: target.label,
      settings: {
        ...CONFIG_STATE.getModelSettingsState().getSettings(target),
        ...session?.modelSettings?.[target.label]
      }
    }
  })
}

/**
 * Keeps browser browsing and subscriptions independent of model initialization.
 * Only accepted commands initialize the existing agent runtime.
 */
export const webSessionRoutes: FastifyPluginAsync<APIOptions> = async (fastify, options) => {
  const base = `/api/${options.apiVersion}/sessions`

  fastify.get(`${base}/models`, async () => {
    const providers = getPublicModelCatalog()

    return {
      providers,
      selection: getSessionSelection(),
      defaults: Object.fromEntries(providers.flatMap((provider) => provider.models.map((model) => {
        const target = `${provider.id}/${model.model}`

        return [target, getSessionSelection(undefined, target).settings]
      })))
    }
  })

  fastify.patch<{ Params: Static<typeof sessionParams>, Body: Static<typeof modelBody> }>(
    `${base}/:session_id/model`, { schema: { params: sessionParams, body: modelBody } },
    async (request, reply) => {
      const session = CONVERSATION_SESSION_MANAGER.getSession(request.params.session_id)
      if (!session) {
        return reply.code(404).send({ message: 'Session not found.' })
      }

      try {
        const body = request.body
        const state = CONFIG_STATE.getModelState()
        if (!state.isSupportedProvider(body.provider)) {
          throw new Error('Unsupported model provider.')
        }
        const target = state.createConfiguredTargetValue(body.provider, body.model)
        const selection = getSessionSelection(session, target)
        const model = getPublicModelCatalog().find((provider) => provider.id === body.provider)
          ?.models.find((candidate) => candidate.model === body.model)
        if ((body.reasoning !== undefined && !model?.reasoning.includes(body.reasoning)) ||
          (body.speed !== undefined && !model?.speed.includes(body.speed))) {
          throw new Error('This setting is not supported by the selected model.')
        }

        const updated = CONVERSATION_SESSION_MANAGER.updateSession(session.id, {
          modelTarget: target,
          modelSettings: {
            ...session.modelSettings,
            [selection.target]: {
              ...session.modelSettings?.[selection.target],
              ...(body.reasoning === undefined ? {} : { reasoning: body.reasoning }),
              ...(body.speed === undefined ? {} : { speed: body.speed })
            }
          }
        })

        return { session: updated, selection: getSessionSelection(updated) }
      } catch (error) {
        return reply.code(400).send({ message: String(error) })
      }
    }
  )

  fastify.post<{ Params: Static<typeof sessionParams>, Body: Static<typeof sendBody> }>(
    `${base}/:session_id/messages`, { schema: { params: sessionParams, body: sendBody } },
    async (request, reply) => {
      const sessionId = request.params.session_id
      if (!CONVERSATION_SESSION_MANAGER.getSession(sessionId)) {
        return reply.code(404).send({ message: 'Session not found.' })
      }
      const query = request.body.query.trim()
      if (!query) {
        return reply.code(400).send({ message: 'A message is required.' })
      }

      try {
        return reply.code(202).send({ command: WEB_SESSION_RUNTIME.submit(sessionId, request.body.id, query) })
      } catch (error) {
        return reply.code(409).send({ message: String(error) })
      }
    }
  )

  fastify.post<{ Params: Static<typeof sessionParams> }>(
    `${base}/:session_id/stop`, { schema: { params: sessionParams } }, async (request, reply) => {
      if (!CONVERSATION_SESSION_MANAGER.getSession(request.params.session_id)) {
        return reply.code(404).send({ message: 'Session not found.' })
      }
      await WEB_SESSION_RUNTIME.stop(request.params.session_id)

      return { success: true }
    }
  )

  fastify.get<{ Querystring: Static<typeof streamQuery> }>(
    `${base}/events`, { schema: { querystring: streamQuery } }, async (request, reply) => {
      const sessionId = request.query.session_id
      if (sessionId && !CONVERSATION_REPOSITORY.readSession(sessionId)) {
        return reply.code(404).send({ message: 'Session not found.' })
      }
      const after = Number(request.headers['last-event-id'] ?? request.query.after ?? 0)
      if (!Number.isSafeInteger(after) || after < 0) {
        return reply.code(400).send({ message: 'Invalid replay cursor.' })
      }

      reply.hijack()
      const response = reply.raw
      for (const [name, value] of Object.entries(reply.getHeaders())) {
        if (value !== undefined) {
          response.setHeader(name, value)
        }
      }
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no'
      })
      response.write(': connected\n\n')
      let unsubscribe: (() => void) | undefined
      let closed = false
      const sessionEvents = CONVERSATION_SESSION_MANAGER.events
      const cleanup = (): void => {
        closed = true
        clearInterval(heartbeat)
        unsubscribe?.()
        sessionEvents.off('updated', onSessionsChanged)
      }
      const write = (value: unknown, sequence?: number): void => {
        if (closed) {
          return
        }
        // Drop a slow connection rather than accumulate an unbounded output queue.
        // Its single browser-managed reconnect resumes from the durable cursor.
        if (response.writableLength > MAXIMUM_STREAM_BACKLOG_BYTES) {
          response.destroy()
          return
        }
        response.write(`${sequence === undefined ? '' : `id: ${sequence}\n`}data: ${JSON.stringify(value)}\n\n`)
      }
      const onSessionsChanged = (): void => write({ type: 'sessions_changed' })
      const heartbeat = setInterval(() => {
        if (response.writableLength > MAXIMUM_STREAM_BACKLOG_BYTES) {
          response.destroy()
        } else {
          response.write(': keepalive\n\n')
        }
      }, HEARTBEAT_INTERVAL_MS)
      heartbeat.unref()
      response.once('close', cleanup)
      sessionEvents.on('updated', onSessionsChanged)
      try {
        unsubscribe = await subscribeAgentEvents({ after_sequence: after }, (event) => {
          if (event.type === 'turn_status' || event.type === 'session_changed' ||
            event.type === 'error' && event.data['code'] === 'replay_snapshot_required' ||
            event.session_id === sessionId) {
            // Browser timelines fetch large invocation bodies only on disclosure.
            if (event.type === 'tool_call') {
              const call = { ...(event.data['tool_call'] as Record<string, unknown>) }
              delete call['input']
              delete call['output']
              delete call['command_output']
              delete call['native_skill_path']
              write({ ...event, data: { tool_call: call } }, event.sequence)
            } else if (event.type === 'final_answer') {
              const data = { ...event.data }
              delete data['response_trace']
              write({ ...event, data }, event.sequence)
            } else {
              write(event, event.sequence)
            }
          }
        })
        if (closed) {
          unsubscribe()
        }
      } catch {
        cleanup()
        response.end()
      }
    }
  )
}
