import { performance } from 'node:perf_hooks'

import { CONVERSATION_LOGGER, POST_TURN_MAINTENANCE_QUEUE } from '@/core'
import { syncOwnerProfileFromTurn } from '@/core/context-manager/owner-profile-sync'
import { ReActLLMDuty } from '@/core/llm-manager/llm-duties/react-llm-duty'
import { getActiveProfileName, runWithProfileContext } from '@/core/profile-runtime/profile-context'
import { ensureActiveProfileRuntime } from '@/core/profile-runtime/initialize-profile-runtime'
import { isValidProfileName } from '@/core/profile-runtime/profile-paths'
import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'

import type {
  HTTPPluginAgentEvent,
  HTTPPluginAgentTrace,
  HTTPPluginRunAgentInput,
  HTTPPluginRunAgentResult,
  HTTPPluginToolCall
} from '../types'
import { publishAgentEvent } from './agent-event-channel'
import { deserializeAgentTrace } from './agent-trace-serializer'
import {
  elapsedMilliseconds,
  normalizeConversationSession,
  normalizeOwnerProfileToolExecutions,
  normalizeToolCalls,
  resolveSessionId
} from './normalizers'

/** Runs one ReAct turn inside the requested profile and conversation session. */
export async function runAgent(
  input: HTTPPluginRunAgentInput
): Promise<HTTPPluginRunAgentResult> {
  const profileName = input.profile_id?.trim() || getActiveProfileName()
  if (!isValidProfileName(profileName)) {
    throw new Error(`Invalid Leon profile name "${profileName}".`)
  }

  return runWithProfileContext({ profileName }, async () => {
    const totalStartedAt = performance.now()
    await ensureActiveProfileRuntime()
    const query = input.query.trim()
    const sessionId = resolveSessionId(input)
    const planSteps = new Map<
      string,
      HTTPPluginAgentTrace['plan_steps'][number]
    >()
    const toolCalls = new Map<string, HTTPPluginToolCall>()
    const toolStartedAt = new Map<string, number>()
    let actionExecutionMs = 0
    let reasoningSummary = 'Understanding your request'
    const requestId = input.request_id || null
    let finalMetrics: Record<string, unknown> | null = null
    let finalTrace: HTTPPluginAgentTrace = { plan_steps: [], tool_calls: [] }
    const emit = (
      type: HTTPPluginAgentEvent['type'],
      data: Record<string, unknown>
    ): void => {
      publishAgentEvent(getActiveProfileName(), {
        session_id: sessionId,
        turn_id: requestId,
        response_id: requestId,
        type,
        data
      })
    }

    emit('session_changed', {
      session: normalizeConversationSession(
        CONVERSATION_SESSION_MANAGER.getSession(sessionId)!
      ),
      is_active: true
    })
    const result = await CONVERSATION_SESSION_MANAGER.runWithSession(
      sessionId,
      async () => {
        // HTTP turns bypass Brain, so persist both sides here to keep history coherent.
        await CONVERSATION_LOGGER.upsert(
          {
            who: 'owner',
            message: query,
            isAddedToHistory: true,
            ...(input.request_id ? { messageId: input.request_id } : {})
          },
          { sessionId }
        )
        CONVERSATION_SESSION_MANAGER.maybeSetFallbackTitle(sessionId, query)

        const duty = new ReActLLMDuty({
          input: query,
          ...(input.additionalInstructions
            ? { additionalInstructions: input.additionalInstructions }
            : {}),
          allowDirectAnswerHandoff: input.allow_direct_answer_handoff === true,
          onProgressEvent: (event): void => {
            if (event.type === 'reasoning_summary') {
              reasoningSummary = event.summary
              emit('reasoning_summary', { summary: event.summary })
              return
            }
            if (event.type === 'plan_step') {
              const step = {
                id: event.step.id,
                label: event.step.label,
                status: event.step.status
              }
              planSteps.set(step.id, step)
              emit('plan_step', { step })
              return
            }

            const toolCall: HTTPPluginToolCall = {
              id: event.toolCall.id,
              name: event.toolCall.name,
              status: event.toolCall.status,
              ...(event.toolCall.toolkitIconName
                ? { toolkit_icon_name: event.toolCall.toolkitIconName }
                : {}),
              ...(event.toolCall.toolIconName
                ? { tool_icon_name: event.toolCall.toolIconName }
                : {}),
              ...(event.toolCall.input !== undefined
                ? { input: event.toolCall.input }
                : {}),
              ...(event.toolCall.output !== undefined
                ? { output: event.toolCall.output }
                : {}),
              ...(event.toolCall.stepLabel
                ? { step_label: event.toolCall.stepLabel }
                : {}),
              ...(event.toolCall.errorMessage
                ? { error_message: event.toolCall.errorMessage }
                : {}),
              ...(event.toolCall.skillId
                ? { skill_id: event.toolCall.skillId }
                : {}),
              ...(event.toolCall.nativeSkillPath
                ? { native_skill_path: event.toolCall.nativeSkillPath }
                : {})
            }
            if (event.toolCall.status === 'running') {
              if (!toolStartedAt.has(event.toolCall.id)) {
                toolStartedAt.set(event.toolCall.id, performance.now())
              }
            } else {
              const startedAt = toolStartedAt.get(event.toolCall.id)
              if (startedAt !== undefined) {
                actionExecutionMs += performance.now() - startedAt
                toolStartedAt.delete(event.toolCall.id)
              }
            }
            toolCalls.set(event.toolCall.id, toolCall)
            emit('tool_call', { tool_call: toolCall })
          }
        })

        await duty.init()
        const dutyResult = await duty.execute()
        const output = dutyResult?.output as unknown
        const data = dutyResult?.data || {}
        const llmMetrics =
          data['llmMetrics'] && typeof data['llmMetrics'] === 'object'
            ? (data['llmMetrics'] as Record<string, unknown>)
            : null
        const metrics = {
          ...(llmMetrics || {}),
          inference_duration_ms: Number(llmMetrics?.['durationMs'] || 0),
          router_response_ms: Number(input.router_response_ms || 0),
          action_execution_ms: Number(actionExecutionMs.toFixed(2)),
          total_duration_ms: elapsedMilliseconds(totalStartedAt)
        }
        finalMetrics = metrics

        for (const toolCall of normalizeToolCalls(dutyResult)) {
          const existing = [...toolCalls.values()].find(
            (candidate) => candidate.name === toolCall.name
          )
          toolCalls.set(existing?.id || toolCall.id || toolCall.name, {
            ...existing,
            ...toolCall
          })
        }
        const trace: HTTPPluginAgentTrace = {
          reasoning_summary: reasoningSummary,
          plan_steps: [...planSteps.values()],
          tool_calls: [...toolCalls.values()],
          metrics
        }
        finalTrace = trace

        if (typeof output === 'string' && output.trim()) {
          const messageId = input.request_id
            ? `${input.request_id}:leon`
            : undefined
          await CONVERSATION_LOGGER.upsert(
            {
              who: 'leon',
              message: output,
              isAddedToHistory: true,
              ...(messageId ? { messageId } : {}),
              agentResponseTrace: deserializeAgentTrace(trace)
            },
            { sessionId }
          )
          emit('metrics', { metrics })
          emit('final_answer', {
            message_id: messageId || '',
            content: output,
            response_trace: trace
          })

          if (data['hasExplicitMemoryWrite'] === true) {
            POST_TURN_MAINTENANCE_QUEUE.enqueue('owner profile sync', () =>
              syncOwnerProfileFromTurn(
                query,
                output,
                normalizeOwnerProfileToolExecutions(dutyResult)
              ).then(() => undefined)
            )
          }
        }

        return dutyResult
      }
    )
    const data = result?.data || {}
    const output = result?.output as unknown

    return {
      answer: typeof output === 'string' ? output : '',
      tier: 'leon-react',
      tool_calls: normalizeToolCalls(result),
      profile_id: getActiveProfileName(),
      session_id: sessionId,
      request_id: input.request_id || null,
      final_intent:
        typeof data['finalIntent'] === 'string' ? data['finalIntent'] : null,
      metrics: finalMetrics || data['llmMetrics'] || null,
      response_trace: finalTrace
    }
  })
}
