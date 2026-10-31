import { collectArtifacts } from '@/core/artifacts/artifact-context'
import type { Artifact } from '@/core/artifacts/artifact-types'
import { performance } from 'node:perf_hooks'
import { randomUUID } from 'node:crypto'
import type { AgentResponseTrace } from '@/types'

import { CONVERSATION_LOGGER } from '@/core'
import { prepareAgentTurn } from '@/core/turn-lifecycle/pre-turn'
import { runTurnLifecycle } from '@/core/turn-lifecycle'
import { runWithTurnTiming, runTurnPhase, TurnPhase, setTurnTimingSession, getTurnTimings } from '@/core/llm-manager/turn-timing'
import { measureOtherProcessingDuration } from '@/core/llm-manager/llm-duties/react-llm-duty/agent-metrics'
import { prepareOwnerAttachments } from '@/core/owner-attachments'
import { getActiveProfileName, runWithProfileContext } from '@/core/profile-runtime/profile-context'
import { ensureActiveProfileRuntime } from '@/core/profile-runtime/initialize-profile-runtime'
import { isValidProfileName } from '@/core/profile-runtime/profile-paths'
import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'
import type { LeonClientInterfaceTokenPayload } from '@/core/leon-interface/types'

import type {
  HTTPPluginAgentEvent,
  HTTPPluginAgentTrace,
  HTTPPluginRunAgentInput,
  HTTPPluginRunAgentResult,
  HTTPPluginToolCall
} from '../types'
import { publishAgentEvent } from './agent-event-channel'
import { deserializeAgentTrace, serializeAgentTrace } from './agent-trace-serializer'
import {
  elapsedMilliseconds,
  normalizeConversationSession,
  normalizeToolCalls,
  resolveSessionId
} from './normalizers'

const TEXT_STREAM_BATCH_INTERVAL_MS = 50
const MAXIMUM_TEXT_STREAM_BATCH_CHARACTERS = 8_192

/**
 * Coalesces provider chunks without introducing an artificial typing cadence.
 * The host flushes before structural events and always releases its timer.
 */
function createTextStreamBatch(emit: (data: Record<string, unknown>) => void): {
  flush: () => void
  push: (kind: 'answer' | 'reasoning', payload: LeonClientInterfaceTokenPayload) => void
} {
  let pending: (LeonClientInterfaceTokenPayload & { kind: 'answer' | 'reasoning' }) | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let failure: unknown
  const flush = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (failure) {
      throw failure
    }
    if (pending) {
      const payload = pending
      pending = null
      emit({ ...payload })
    }
  }

  return {
    flush,
    push(kind: 'answer' | 'reasoning', payload: LeonClientInterfaceTokenPayload): void {
      if (pending && (pending.kind !== kind || pending.generationId !== payload.generationId || payload.reset)) {
        flush()
      }
      pending = { ...payload, kind, token: `${pending?.token ?? ''}${payload.token}` }
      if (payload.reset || pending.token.length >= MAXIMUM_TEXT_STREAM_BATCH_CHARACTERS) {
        flush()
      } else if (timer === null) {
        timer = setTimeout(() => {
          try {
            flush()
          } catch (error) {
            // Propagate a durable-write failure on the next host operation.
            failure = error
          }
        }, TEXT_STREAM_BATCH_INTERVAL_MS)
      }
    }
  }
}

/**
 * Runs one ReAct turn inside the requested profile and conversation session.
 */
export async function runAgent(
  input: HTTPPluginRunAgentInput
): Promise<HTTPPluginRunAgentResult> {
  input.signal?.throwIfAborted()
  const profileName = input.profile_id?.trim() || getActiveProfileName()
  if (!isValidProfileName(profileName)) {
    throw new Error(`Invalid Leon profile name "${profileName}".`)
  }

  const turnId = input.request_id ?? randomUUID()

  return runWithProfileContext({ profileName }, () => runWithTurnTiming(turnId, input.session_id ?? null, async () => {
    const totalStartedAt = performance.now()
    await runTurnPhase(TurnPhase.Runtime, () => ensureActiveProfileRuntime())
    input.signal?.throwIfAborted()
    const sessionId = runTurnPhase(TurnPhase.Session, () => resolveSessionId(input))
    setTurnTimingSession(sessionId)
    const { query, files } = await runTurnPhase(TurnPhase.Attachments, () => prepareOwnerAttachments(input.query.trim(), input.attachments, sessionId))
    const planSteps = new Map<
      string,
      HTTPPluginAgentTrace['plan_steps'][number]
    >()
    const planTransitions: NonNullable<
      HTTPPluginAgentTrace['plan_transitions']
    > = []
    const toolCalls = new Map<string, HTTPPluginToolCall>()
    const progressMessages = new Map<
      string,
      NonNullable<HTTPPluginAgentTrace['progress_messages']>[number]
    >()
    const toolStartedAt = new Map<string, number>()
    let actionExecutionMs = 0
    let reasoningSummary = 'Understanding your request'
    const requestId = input.request_id || null
    const messageId = `${turnId}:leon`
    let turnArtifacts: Artifact[] = []
    let finalMetrics: Record<string, unknown> | null = null
    let finalTrace: HTTPPluginAgentTrace = { plan_steps: [], tool_calls: [] }
    const publish = (
      type: HTTPPluginAgentEvent['type'],
      data: Record<string, unknown>
    ): void => {
      publishAgentEvent(getActiveProfileName(), {
        session_id: sessionId,
        turn_id: requestId,
        response_id: messageId || null,
        type,
        data
      })
    }
    const stream = createTextStreamBatch((data) => publish('text_stream', data))
    const emit: typeof publish = (type, data): void => {
      stream.flush()
      publish(type, data)
    }

    emit('session_changed', {
      session: normalizeConversationSession(
        CONVERSATION_SESSION_MANAGER.getSession(sessionId)!
      ),
      is_active: true
    })
    const result = await runTurnLifecycle(
      { sessionId, query, turnId: requestId ?? messageId },
      async () => {
        // HTTP turns bypass Brain, so persist both sides here to keep history coherent.
        await runTurnPhase(TurnPhase.Owner, () => CONVERSATION_LOGGER.upsert(
          {
            who: 'owner',
            message: query,
            isAddedToHistory: true,
            ...(input.request_id ? { messageId: input.request_id } : {})
          },
          { sessionId }
        ))
        CONVERSATION_SESSION_MANAGER.maybeSetFallbackTitle(sessionId, query)

        const duty = await prepareAgentTurn({
          input: query,
          responseId: messageId,
          onTextStream: (kind, payload): void => {
            stream.push(kind, payload)
          },
          ...(files.length ? { files } : {}),
          ...(input.signal ? { signal: input.signal } : {}),
          ...(input.additionalInstructions
            ? { additionalInstructions: input.additionalInstructions }
            : {}),
          allowDirectAnswerHandoff: input.allow_direct_answer_handoff === true,
          onProgressEvent: (event): void => {
            if (event.type === 'inference_activity') {
              emit('inference_activity', { activity: event.activity })
              return
            }
            if (event.type === 'progress_message') {
              const message = {
                id: event.message.id,
                content: event.message.content,
                created_at: event.message.createdAt,
                ...(event.message.planStepId !== undefined ? { plan_step_id: event.message.planStepId } : {})
              }
              progressMessages.set(message.id, message)
              emit('progress_message', { message })
              return
            }
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
              const previousStep = planSteps.get(step.id)

              if (
                previousStep?.label !== step.label ||
                previousStep.status !== step.status
              ) {
                planTransitions.push({ ...step, changed_at: Date.now() })
              }

              planSteps.set(step.id, step)
              emit('plan_step', { step })
              return
            }

            const serialized = serializeAgentTrace({
              planSteps: [], toolCalls: [event.toolCall]
            }, true).tool_calls[0]!
            const toolCall: HTTPPluginToolCall = {
              ...toolCalls.get(event.toolCall.id),
              ...serialized
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

        input.signal?.throwIfAborted()
        const collected = await runTurnPhase(TurnPhase.Execution, () => collectArtifacts(() => duty.execute()))
        const dutyResult = collected.value

        turnArtifacts = collected.artifacts
        input.signal?.throwIfAborted()
        const output = dutyResult?.output as unknown
        const data = dutyResult?.data || {}
        const llmMetrics =
          data['llmMetrics'] && typeof data['llmMetrics'] === 'object'
            ? (data['llmMetrics'] as Record<string, unknown>)
            : null
        const timings = getTurnTimings()
        const startedAt = timings.find((timing) => timing.goal === TurnPhase.Turn)?.startedAt
        const durationMs = elapsedMilliseconds(totalStartedAt)
        const otherDuration = startedAt === undefined ? undefined : measureOtherProcessingDuration(
          startedAt, durationMs,
          timings.filter((timing) => timing.kind === 'inference' || timing.goal === TurnPhase.Tool)
        )
        const metrics = {
          ...(llmMetrics || {}),
          durationMs,
          ...(otherDuration === undefined ? {} : { otherProcessingDurationMs: otherDuration }),
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
        const durableTrace = data['agentResponseTrace']
          ? serializeAgentTrace(data['agentResponseTrace'] as AgentResponseTrace, false)
          : null
        const trace: HTTPPluginAgentTrace = {
          ...durableTrace,
          reasoning_summary: reasoningSummary,
          ...(progressMessages.size > 0
            ? { progress_messages: [...progressMessages.values()] }
            : {}),
          plan_steps: [...planSteps.values()],
          ...(planTransitions.length > 0
            ? { plan_transitions: planTransitions }
            : {}),
          tool_calls: durableTrace?.tool_calls || [...toolCalls.values()],
          metrics,
          timings: getTurnTimings()
        }
        finalTrace = trace

        if (typeof output === 'string' && output.trim()) {
          await runTurnPhase(TurnPhase.Persistence, () => CONVERSATION_LOGGER.upsert(
            {
              who: 'leon',
              message: output,
              isAddedToHistory: true,
              artifacts: turnArtifacts,
              ...(messageId ? { messageId } : {}),
              agentResponseTrace: {
                ...((data['agentResponseTrace'] as AgentResponseTrace | undefined) || deserializeAgentTrace(trace)),
                metrics,
                timings: trace.timings ?? []
              }
            },
            { sessionId }
          ))
          emit('metrics', { metrics })
          emit('final_answer', {
            message_id: messageId || '',
            content: output,
            response_trace: trace,
            artifacts: turnArtifacts
          })
        }

        return dutyResult
      }
    ).finally(stream.flush)
    const data = result?.data || {}
    const output = result?.output as unknown

    return {
      answer: typeof output === 'string' ? output : '',
      tier: 'leon-react',
      artifacts: turnArtifacts,
      tool_calls: normalizeToolCalls(result),
      profile_id: getActiveProfileName(),
      session_id: sessionId,
      request_id: input.request_id || null,
      final_intent:
        typeof data['finalIntent'] === 'string' ? data['finalIntent'] : null,
      metrics: finalMetrics || data['llmMetrics'] || null,
      response_trace: finalTrace
    }
  }))
}
