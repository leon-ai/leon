import { performance } from 'node:perf_hooks'
import { EventEmitter } from 'node:events'

import {
  BRAIN,
  CONVERSATION_LOGGER,
  LLM_MANAGER,
  NLU,
  POST_TURN_MAINTENANCE_QUEUE
} from '@/core'
import { syncOwnerProfileFromTurn } from '@/core/context-manager/owner-profile-sync'
import type { LLMDutyResult } from '@/core/llm-manager/llm-duty'
import { ActionCallingLLMDuty } from '@/core/llm-manager/llm-duties/action-calling-llm-duty'
import { ReActLLMDuty } from '@/core/llm-manager/llm-duties/react-llm-duty'
import {
  ActionCallingStatus,
  type ActionCallingOutput
} from '@/core/llm-manager/types'
import {
  DEFAULT_NLU_PROCESS_RESULT,
  NLUProcessResultUpdater
} from '@/core/nlp/nlu/nlu-process-result-updater'
import {
  getActiveProfileName,
  runWithProfileContext
} from '@/core/profile-runtime/profile-context'
import { ensureActiveProfileRuntime } from '@/core/profile-runtime/initialize-profile-runtime'
import { isValidProfileName } from '@/core/profile-runtime/profile-paths'
import {
  CONVERSATION_SESSION_MANAGER,
  type ConversationSession
} from '@/core/session-manager'
import { ConversationHistoryHelper } from '@/helpers/conversation-history-helper'

import type {
  HTTPPluginAppendConversationMessageInput,
  HTTPPluginAppendConversationMessageResult,
  HTTPPluginConversationMessage,
  HTTPPluginConversationSession,
  HTTPPluginGetConversationHistoryInput,
  HTTPPluginGetConversationHistoryResult,
  HTTPPluginLeonServices,
  HTTPPluginListConversationSessionsInput,
  HTTPPluginListConversationSessionsResult,
  HTTPPluginRunControlledSkillInput,
  HTTPPluginRunControlledSkillResult,
  HTTPPluginRunAgentInput,
  HTTPPluginRunAgentResult,
  HTTPPluginToolCall,
  HTTPPluginAgentEvent,
  HTTPPluginAgentTrace,
  HTTPPluginConversationSessionMutationResult,
  HTTPPluginCreateConversationSessionInput,
  HTTPPluginSelectConversationSessionInput,
  HTTPPluginSubscribeAgentEventsInput
} from './types'

const CONTROLLED_HISTORY_LIMIT = 6
const CONTROLLED_CONTEXT_UTTERANCE_LIMIT = 4
const DEFAULT_HISTORY_LIMIT = 100
const MAXIMUM_HISTORY_LIMIT = 500
const MAXIMUM_REPLAY_EVENTS = 500

interface AgentEventChannel {
  sequence: number
  events: HTTPPluginAgentEvent[]
  emitter: EventEmitter
}

const agentEventChannels = new Map<string, AgentEventChannel>()

function getAgentEventChannel(profileId: string): AgentEventChannel {
  let channel = agentEventChannels.get(profileId)
  if (!channel) {
    channel = { sequence: 0, events: [], emitter: new EventEmitter() }
    channel.emitter.setMaxListeners(100)
    agentEventChannels.set(profileId, channel)
  }

  return channel
}

function publishAgentEvent(
  profileId: string,
  event: Omit<HTTPPluginAgentEvent, 'sequence' | 'profile_id' | 'created_at'>
): HTTPPluginAgentEvent {
  const channel = getAgentEventChannel(profileId)
  const published: HTTPPluginAgentEvent = {
    ...event,
    sequence: ++channel.sequence,
    profile_id: profileId,
    created_at: Date.now()
  }
  channel.events.push(published)
  if (channel.events.length > MAXIMUM_REPLAY_EVENTS) {
    channel.events.splice(0, channel.events.length - MAXIMUM_REPLAY_EVENTS)
  }
  channel.emitter.emit('event', published)

  return published
}

function elapsedMilliseconds(startedAt: number): number {
  return Number((performance.now() - startedAt).toFixed(2))
}

function getStringField(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === 'string' ? record[key].trim() : ''
}

function normalizeToolCalls(result: LLMDutyResult | null): HTTPPluginToolCall[] {
  const data = result?.data || {}
  const executionHistory = Array.isArray(data['executionHistory'])
    ? data['executionHistory']
    : []

  return executionHistory
    .map((item, index): HTTPPluginToolCall | null => {
      if (!item || typeof item !== 'object') {
        return null
      }

      const record = item as Record<string, unknown>
      const name = getStringField(record, 'function')

      if (!name) {
        return null
      }

      const toolCall: HTTPPluginToolCall = {
        id: `tool-${index + 1}`,
        name,
        status: record['status'] === 'error' ? 'error' : 'success'
      }
      const observation = getStringField(record, 'observation')
      const stepLabel = getStringField(record, 'stepLabel')

      if (observation) {
        toolCall.observation = observation
      }
      if (stepLabel) {
        toolCall.step_label = stepLabel
      }
      if (record['requestedToolInput'] !== undefined) {
        toolCall.input = record['requestedToolInput']
      }

      return toolCall
    })
    .filter((item): item is HTTPPluginToolCall => item !== null)
}

function normalizeOwnerProfileToolExecutions(
  result: LLMDutyResult | null
): Array<{
  functionName: string
  status: 'success' | 'error'
  observation: string
}> {
  const data = result?.data || {}
  const executionHistory = Array.isArray(data['executionHistory'])
    ? data['executionHistory']
    : []

  return executionHistory
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null
      }

      const record = item as Record<string, unknown>
      const functionName = getStringField(record, 'function')

      if (!functionName) {
        return null
      }

      return {
        functionName,
        status: record['status'] === 'error' ? 'error' as const : 'success' as const,
        observation: getStringField(record, 'observation')
      }
    })
    .filter((item): item is {
      functionName: string
      status: 'success' | 'error'
      observation: string
    } => item !== null)
}

function stripDeveloperProvenance(
  trace: HTTPPluginAgentTrace,
  includeDeveloperProvenance: boolean
): HTTPPluginAgentTrace {
  if (includeDeveloperProvenance) {
    return trace
  }

  return {
    ...trace,
    tool_calls: trace.tool_calls.map((toolCall) => {
      const sanitized = { ...toolCall }
      delete sanitized.native_skill_path
      return sanitized
    })
  }
}

function normalizeConversationSession(
  session: ConversationSession
): HTTPPluginConversationSession {
  return {
    id: session.id,
    title: session.title,
    is_pinned: session.isPinned,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    last_message_at: session.lastMessageAt,
    message_count: session.messageCount
  }
}

function normalizeHistoryLimit(limit?: number): number {
  if (!Number.isInteger(limit) || !limit || limit < 1) {
    return DEFAULT_HISTORY_LIMIT
  }

  return Math.min(limit, MAXIMUM_HISTORY_LIMIT)
}

/** Lists conversation sessions inside one trusted profile runtime. */
export async function listConversationSessions(
  input: HTTPPluginListConversationSessionsInput
): Promise<HTTPPluginListConversationSessionsResult> {
  const profileName = input.profile_id?.trim() || getActiveProfileName()

  if (!isValidProfileName(profileName)) {
    throw new Error(`Invalid Leon profile name "${profileName}".`)
  }

  return runWithProfileContext({ profileName }, async () => {
    await ensureActiveProfileRuntime()

    return {
      profile_id: getActiveProfileName(),
      active_session_id: CONVERSATION_SESSION_MANAGER.getActiveSessionId(),
      sessions: CONVERSATION_SESSION_MANAGER.listSessions().map(
        normalizeConversationSession
      )
    }
  })
}

/** Reads persisted, user-visible conversation messages for one profile session. */
export async function getConversationHistory(
  input: HTTPPluginGetConversationHistoryInput
): Promise<HTTPPluginGetConversationHistoryResult> {
  const profileName = input.profile_id?.trim() || getActiveProfileName()

  if (!isValidProfileName(profileName)) {
    throw new Error(`Invalid Leon profile name "${profileName}".`)
  }

  return runWithProfileContext({ profileName }, async () => {
    await ensureActiveProfileRuntime()
    const sessionId = input.session_id.trim()

    if (!sessionId) {
      throw new Error('A conversation session ID is required.')
    }
    if (!CONVERSATION_SESSION_MANAGER.getSession(sessionId)) {
      throw new Error(
        `Conversation session "${sessionId}" does not exist in profile "${profileName}".`
      )
    }

    const logs = await CONVERSATION_LOGGER.load({
      sessionId,
      nbOfLogsToLoad: normalizeHistoryLimit(input.limit)
    })
    const messages: HTTPPluginConversationMessage[] =
      ConversationHistoryHelper.toHistoryItems(
        logs.filter((log) => ConversationHistoryHelper.isAddedToHistory(log)),
        { supportsWidgets: false, source: 'conversation_history' }
      ).map((item) => ({
        role: item.who === 'leon' ? 'assistant' : 'owner',
        content: item.string,
        created_at: item.sentAt,
        message_id: item.messageId || null,
        metrics: item.llmMetrics || null,
        response_trace: item.agentResponseTrace
          ? stripDeveloperProvenance(
              {
                ...(item.agentResponseTrace.reasoningSummary
                  ? {
                      reasoning_summary:
                        item.agentResponseTrace.reasoningSummary
                    }
                  : {}),
                plan_steps: item.agentResponseTrace.planSteps.map((step) => ({
                  id: step.id,
                  label: step.label,
                  status: step.status
                })),
                tool_calls: item.agentResponseTrace.toolCalls.map((toolCall) => ({
                  id: toolCall.id,
                  name: toolCall.name,
                  status: toolCall.status,
                  ...(toolCall.input !== undefined
                    ? { input: toolCall.input }
                    : {}),
                  ...(toolCall.output !== undefined
                    ? { output: toolCall.output }
                    : {}),
                  ...(toolCall.stepLabel
                    ? { step_label: toolCall.stepLabel }
                    : {}),
                  ...(toolCall.errorMessage
                    ? { error_message: toolCall.errorMessage }
                    : {}),
                  ...(toolCall.skillId ? { skill_id: toolCall.skillId } : {}),
                  ...(toolCall.nativeSkillPath
                    ? { native_skill_path: toolCall.nativeSkillPath }
                    : {})
                })),
                ...(item.agentResponseTrace.metrics
                  ? { metrics: item.agentResponseTrace.metrics }
                  : {})
              },
              input.include_developer_provenance === true
            )
          : null
      }))

    return {
      profile_id: getActiveProfileName(),
      session_id: sessionId,
      messages
    }
  })
}

/** Creates and activates an owner-scoped conversation session. */
export async function createConversationSession(
  input: HTTPPluginCreateConversationSessionInput
): Promise<HTTPPluginConversationSessionMutationResult> {
  const profileName = input.profile_id?.trim() || getActiveProfileName()
  if (!isValidProfileName(profileName)) {
    throw new Error(`Invalid Leon profile name "${profileName}".`)
  }

  return runWithProfileContext({ profileName }, async () => {
    await ensureActiveProfileRuntime()
    const session = CONVERSATION_SESSION_MANAGER.createSession()
    const normalizedSession = normalizeConversationSession(session)
    publishAgentEvent(getActiveProfileName(), {
      session_id: session.id,
      turn_id: null,
      response_id: null,
      type: 'session_changed',
      data: { session: normalizedSession, is_active: true }
    })

    return {
      profile_id: getActiveProfileName(),
      active_session_id: session.id,
      session: normalizedSession
    }
  })
}

/** Selects an existing owner-scoped conversation session. */
export async function selectConversationSession(
  input: HTTPPluginSelectConversationSessionInput
): Promise<HTTPPluginConversationSessionMutationResult> {
  const profileName = input.profile_id?.trim() || getActiveProfileName()
  if (!isValidProfileName(profileName)) {
    throw new Error(`Invalid Leon profile name "${profileName}".`)
  }

  return runWithProfileContext({ profileName }, async () => {
    await ensureActiveProfileRuntime()
    const session = CONVERSATION_SESSION_MANAGER.setActiveSession(
      input.session_id.trim()
    )
    const normalizedSession = normalizeConversationSession(session)
    publishAgentEvent(getActiveProfileName(), {
      session_id: session.id,
      turn_id: null,
      response_id: null,
      type: 'session_changed',
      data: { session: normalizedSession, is_active: true }
    })

    return {
      profile_id: getActiveProfileName(),
      active_session_id: session.id,
      session: normalizedSession
    }
  })
}

/** Replays buffered events and then subscribes to live owner-scoped events. */
export async function subscribeAgentEvents(
  input: HTTPPluginSubscribeAgentEventsInput,
  listener: (event: HTTPPluginAgentEvent) => void
): Promise<() => void> {
  const profileName = input.profile_id?.trim() || getActiveProfileName()
  if (!isValidProfileName(profileName)) {
    throw new Error(`Invalid Leon profile name "${profileName}".`)
  }
  await runWithProfileContext({ profileName }, ensureActiveProfileRuntime)
  const channel = getAgentEventChannel(profileName)
  const matches = (event: HTTPPluginAgentEvent): boolean =>
    (!input.session_id || event.session_id === input.session_id) &&
    event.sequence > (input.after_sequence || 0)

  for (const event of channel.events.filter(matches)) {
    listener(event)
  }
  const onEvent = (event: HTTPPluginAgentEvent): void => {
    if (matches(event)) listener(event)
  }
  channel.emitter.on('event', onEvent)

  return () => channel.emitter.off('event', onEvent)
}

function resolveSessionId(input: {
  session_id?: string
  create_session?: boolean
}): string {
  const requestedSession = input.session_id
    ? CONVERSATION_SESSION_MANAGER.getSession(input.session_id)
    : null
  const createdSession = !requestedSession && input.create_session === true
    ? CONVERSATION_SESSION_MANAGER.createSession()
    : null

  return requestedSession?.id || createdSession?.id ||
    CONVERSATION_SESSION_MANAGER.getActiveSessionId()
}

function parseActionCallingOutput(result: LLMDutyResult | null): ActionCallingOutput[] {
  if (!result) {
    return []
  }

  try {
    const output = result.output as unknown
    const parsed = JSON.parse(
      typeof output === 'string' ? output : JSON.stringify(output)
    ) as unknown

    return Array.isArray(parsed) ? parsed as ActionCallingOutput[] : []
  } catch {
    return []
  }
}

function getSkillAnswerText(answer: unknown): string {
  if (typeof answer === 'string') {
    return answer.trim()
  }
  if (!answer || typeof answer !== 'object') {
    return ''
  }

  const answerConfig = answer as Record<string, unknown>
  const text = typeof answerConfig['text'] === 'string'
    ? answerConfig['text']
    : answerConfig['speech']

  return typeof text === 'string' ? text.trim() : ''
}

/**
 * Runs one native skill as a bounded controlled-mode decision.
 *
 * A designated fallback action remains uncommitted so the caller can hand the
 * same owner turn to agent mode without duplicating conversation history.
 */
export async function runControlledSkill(
  input: HTTPPluginRunControlledSkillInput
): Promise<HTTPPluginRunControlledSkillResult> {
  const totalStartedAt = performance.now()
  const profileName = input.profile_id?.trim() || getActiveProfileName()

  if (!isValidProfileName(profileName)) {
    throw new Error(`Invalid Leon profile name "${profileName}".`)
  }

  return runWithProfileContext({ profileName }, async () => {
    const profileStartedAt = performance.now()
    await ensureActiveProfileRuntime()
    const profileActivationMs = elapsedMilliseconds(profileStartedAt)
    const query = input.query.trim()
    const skillName = input.skill_name.trim()
    const sessionId = resolveSessionId(input)
    const requestId = input.request_id || null
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

    if (!query) {
      throw new Error('A controlled-skill query is required.')
    }
    if (!skillName) {
      throw new Error('A controlled skill name is required.')
    }

    emit('session_changed', {
      session: normalizeConversationSession(
        CONVERSATION_SESSION_MANAGER.getSession(sessionId)!
      ),
      is_active: true
    })
    emit('reasoning_summary', { summary: 'Choosing the right action' })

    return CONVERSATION_SESSION_MANAGER.runWithSession(
      sessionId,
      async () => {
        const historyStartedAt = performance.now()
        const history = await CONVERSATION_LOGGER.load({
          nbOfLogsToLoad: CONTROLLED_HISTORY_LIMIT
        })
        const historyLoadMs = elapsedMilliseconds(historyStartedAt)
        const recentUtterances = history
          .filter((message) => message.who === 'owner')
          .map((message) => message.message)
          .slice(-CONTROLLED_CONTEXT_UTTERANCE_LIMIT)
        const currentContext = NLU.nluProcessResult.context
        const duty = new ActionCallingLLMDuty({
          input: query,
          skillName,
          history,
          workflowContext: {
            recentUtterances,
            recentActionArguments:
              currentContext.actionArguments.slice(-CONTROLLED_CONTEXT_UTTERANCE_LIMIT),
            collectedParameters: {},
            recentEntities: currentContext.entities
              .slice(-CONTROLLED_CONTEXT_UTTERANCE_LIMIT)
              .map((entity) => ({
                entity: entity.entity,
                sourceText: entity.sourceText,
                resolution: entity.resolution
              }))
          }
        })

        const inferenceStartedAt = performance.now()
        await duty.init()
        const dutyResult = await duty.execute()
        const inferenceDurationMs = elapsedMilliseconds(inferenceStartedAt)
        const dutyUsage = dutyResult as (LLMDutyResult & {
          usedInputTokens?: number
          usedOutputTokens?: number
        }) | null
        const baseMetrics = {
          profile_activation_ms: profileActivationMs,
          history_load_ms: historyLoadMs,
          inference_duration_ms: inferenceDurationMs,
          router_response_ms: inferenceDurationMs,
          input_tokens: Number(dutyUsage?.usedInputTokens || 0),
          output_tokens: Number(dutyUsage?.usedOutputTokens || 0)
        }
        const outputs = parseActionCallingOutput(dutyResult)
        const selected = outputs.length === 1 ? outputs[0] : null
        const isFallback =
          selected?.status === ActionCallingStatus.Success &&
          'name' in selected &&
          selected.name === input.fallback_action_name
        const isSuccess =
          selected?.status === ActionCallingStatus.Success &&
          'name' in selected &&
          !isFallback

        if (!isSuccess) {
          const status = selected?.status === ActionCallingStatus.MissingParams
            ? 'missing_parameters'
            : dutyResult ? 'not_found' : 'error'

          return {
            answer: '',
            tier: 'leon-controlled' as const,
            matched: false,
            status,
            action: null,
            profile_id: getActiveProfileName(),
            session_id: sessionId,
            request_id: input.request_id || null,
            metrics: {
              ...baseMetrics,
              total_duration_ms: elapsedMilliseconds(totalStartedAt),
              action_execution_ms: 0,
              persistence_ms: 0
            }
          }
        }

        const action = {
          name: selected.name,
          input: selected.arguments
        }
        const toolCallId = `${input.request_id || sessionId}:controlled-action`
        const runningToolCall: HTTPPluginToolCall = {
          id: toolCallId,
          name: action.name,
          status: 'running',
          input: action.input,
          skill_id: skillName
        }
        emit('tool_call', { tool_call: runningToolCall })

        const ownerPersistenceStartedAt = performance.now()
        await CONVERSATION_LOGGER.upsert(
          {
            who: 'owner',
            message: query,
            isAddedToHistory: true,
            ...(input.request_id ? { messageId: input.request_id } : {})
          },
          { sessionId }
        )
        let persistenceMs = elapsedMilliseconds(ownerPersistenceStartedAt)
        CONVERSATION_SESSION_MANAGER.maybeSetFallbackTitle(sessionId, query)

        let answer = ''
        const wasBrainMuted = BRAIN.isMuted
        const actionStartedAt = performance.now()
        try {
          await NLUProcessResultUpdater.update({ new: { utterance: query } })
          await NLUProcessResultUpdater.update({ skillName })
          await NLUProcessResultUpdater.update({ actionName: action.name })
          await NLUProcessResultUpdater.update({
            new: { actionArguments: action.input }
          })
          // The HTTP caller owns delivery. Muting avoids the socket/TTS
          // paraphrase pass while still executing and collecting the action.
          BRAIN.isMuted = true
          const processedData = await BRAIN.runSkillAction(NLU.nluProcessResult)
          answer = getSkillAnswerText(
            processedData.lastOutputFromSkill?.answer
          )
        } finally {
          BRAIN.isMuted = wasBrainMuted
          // Controlled HTTP turns are complete after one action. Persisted
          // conversation logs, rather than transient workflow state, carry
          // context into the next turn.
          NLU.nluProcessResult = structuredClone(DEFAULT_NLU_PROCESS_RESULT)
        }
        const actionExecutionMs = elapsedMilliseconds(actionStartedAt)
        const metrics = {
          ...baseMetrics,
          total_duration_ms: elapsedMilliseconds(totalStartedAt),
          action_execution_ms: actionExecutionMs,
          persistence_ms: Number(persistenceMs.toFixed(2))
        }
        const completedToolCall: HTTPPluginToolCall = {
          ...runningToolCall,
          status: 'success',
          ...(answer ? { output: answer } : {})
        }
        const trace: HTTPPluginAgentTrace = {
          reasoning_summary: 'Completed the selected action',
          plan_steps: [],
          tool_calls: [completedToolCall],
          metrics
        }
        emit('tool_call', { tool_call: completedToolCall })

        if (answer) {
          const answerPersistenceStartedAt = performance.now()
          await CONVERSATION_LOGGER.upsert(
            {
              who: 'leon',
              message: answer,
              isAddedToHistory: true,
              ...(input.request_id
                ? { messageId: `${input.request_id}:leon` }
                : {}),
              agentResponseTrace: {
                reasoningSummary: 'Completed the selected action',
                planSteps: [],
                toolCalls: [{
                  id: toolCallId,
                  name: action.name,
                  status: 'success',
                  input: action.input,
                  ...(answer ? { output: answer } : {}),
                  skillId: skillName
                }],
                metrics
              }
            },
            { sessionId }
          )
          persistenceMs += elapsedMilliseconds(answerPersistenceStartedAt)
        }

        metrics.persistence_ms = Number(persistenceMs.toFixed(2))
        metrics.total_duration_ms = elapsedMilliseconds(totalStartedAt)
        emit('metrics', { metrics })
        emit('final_answer', {
          message_id: input.request_id ? `${input.request_id}:leon` : '',
          content: answer,
          response_trace: trace
        })

        return {
          answer,
          tier: 'leon-controlled' as const,
          matched: true,
          status: 'success' as const,
          action,
          profile_id: getActiveProfileName(),
          session_id: sessionId,
          request_id: input.request_id || null,
          metrics
        }
      }
    )
  })
}

/**
 * Adds externally produced conversation content to an existing profile session.
 * This lets integrations preserve continuity without running another inference.
 */
export async function appendConversationMessage(
  input: HTTPPluginAppendConversationMessageInput
): Promise<HTTPPluginAppendConversationMessageResult> {
  const profileName = input.profile_id?.trim() || getActiveProfileName()

  if (!isValidProfileName(profileName)) {
    throw new Error(`Invalid Leon profile name "${profileName}".`)
  }

  return runWithProfileContext({ profileName }, async () => {
    await ensureActiveProfileRuntime()
    const sessionId = input.session_id.trim()
    const message = input.message.trim()

    if (!sessionId) {
      throw new Error('A conversation session ID is required.')
    }
    if (!CONVERSATION_SESSION_MANAGER.getSession(sessionId)) {
      throw new Error(
        `Conversation session "${sessionId}" does not exist in profile "${profileName}".`
      )
    }
    if (!message) {
      throw new Error('A conversation message is required.')
    }

    await CONVERSATION_LOGGER.upsert(
      {
        who: input.role === 'assistant' ? 'leon' : 'owner',
        message,
        isAddedToHistory: true,
        ...(input.message_id ? { messageId: input.message_id } : {})
      },
      { sessionId }
    )

    if (input.role === 'assistant') {
      publishAgentEvent(getActiveProfileName(), {
        session_id: sessionId,
        turn_id: input.message_id || null,
        response_id: input.message_id || null,
        type: 'final_answer',
        data: {
          message_id: input.message_id || '',
          content: message,
          response_trace: {
            plan_steps: [],
            tool_calls: []
          }
        }
      })
    }

    return {
      profile_id: getActiveProfileName(),
      session_id: sessionId,
      role: input.role,
      message_id: input.message_id || null
    }
  })
}

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
    const planSteps = new Map<string, HTTPPluginAgentTrace['plan_steps'][number]>()
    const toolCalls = new Map<string, HTTPPluginToolCall>()
    const toolStartedAt = new Map<string, number>()
    let actionExecutionMs = 0
    let reasoningSummary = 'Understanding your request'
    const requestId = input.request_id || null
    let finalMetrics: Record<string, unknown> | null = null
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
        // HTTP agent turns bypass the socket NLU/Brain path, so persist both
        // sides here to give ReAct the same coherent session history.
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
        const metrics = {
          ...(data['llmMetrics'] && typeof data['llmMetrics'] === 'object'
            ? data['llmMetrics'] as Record<string, unknown>
            : {}),
          inference_duration_ms:
            typeof data['llmMetrics'] === 'object' && data['llmMetrics']
              ? Number(
                  (data['llmMetrics'] as Record<string, unknown>)['durationMs'] || 0
                )
              : 0,
          router_response_ms: Number(input.router_response_ms || 0),
          action_execution_ms: Number(actionExecutionMs.toFixed(2)),
          total_duration_ms: elapsedMilliseconds(totalStartedAt)
        }
        finalMetrics = metrics
        const finalToolCalls = normalizeToolCalls(dutyResult)
        for (const toolCall of finalToolCalls) {
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
              agentResponseTrace: {
                reasoningSummary,
                planSteps: trace.plan_steps.map((step) => ({ ...step })),
                toolCalls: trace.tool_calls.map((toolCall) => ({
                  id: toolCall.id || toolCall.name,
                  name: toolCall.name,
                  status: toolCall.status,
                  ...(toolCall.input !== undefined
                    ? { input: toolCall.input }
                    : {}),
                  ...(toolCall.output !== undefined
                    ? { output: toolCall.output }
                    : {}),
                  ...(toolCall.step_label
                    ? { stepLabel: toolCall.step_label }
                    : {}),
                  ...(toolCall.error_message
                    ? { errorMessage: toolCall.error_message }
                    : {}),
                  ...(toolCall.skill_id
                    ? { skillId: toolCall.skill_id }
                    : {}),
                  ...(toolCall.native_skill_path
                    ? { nativeSkillPath: toolCall.native_skill_path }
                    : {})
                })),
                metrics
              }
            },
            { sessionId }
          )
          emit('metrics', { metrics })
          emit('final_answer', {
            message_id: messageId || '',
            content: output,
            response_trace: trace
          })

          // HTTP agent turns bypass NLU, so mirror its explicit-memory owner
          // profile maintenance after the user-visible answer is available.
          if (data['hasExplicitMemoryWrite'] === true) {
            POST_TURN_MAINTENANCE_QUEUE.enqueue(
              'owner profile sync',
              () => syncOwnerProfileFromTurn(
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
      metrics: finalMetrics || data['llmMetrics'] || null
    }
  })
}

export function createHTTPPluginLeonServices(): HTTPPluginLeonServices {
  return {
    get profileId(): string {
      return getActiveProfileName()
    },
    isLLMEnabled: () => LLM_MANAGER.isLLMEnabled,
    runAgent,
    runControlledSkill,
    appendConversationMessage,
    listConversationSessions,
    getConversationHistory,
    createConversationSession,
    selectConversationSession,
    subscribeAgentEvents
  }
}
