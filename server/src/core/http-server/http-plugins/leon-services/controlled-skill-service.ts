import { performance } from 'node:perf_hooks'

import { BRAIN, CONVERSATION_LOGGER, NLU } from '@/core'
import type { LLMDutyResult } from '@/core/llm-manager/llm-duty'
import { ActionCallingLLMDuty } from '@/core/llm-manager/llm-duties/action-calling-llm-duty'
import { ActionCallingStatus } from '@/core/llm-manager/types'
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
import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'

import type {
  HTTPPluginAgentEvent,
  HTTPPluginAgentTrace,
  HTTPPluginRunControlledSkillInput,
  HTTPPluginRunControlledSkillResult,
  HTTPPluginToolCall
} from '../types'
import { publishAgentEvent } from './agent-event-channel'
import { deserializeAgentTrace } from './agent-trace-serializer'
import {
  elapsedMilliseconds,
  getSkillAnswerText,
  normalizeConversationSession,
  parseActionCallingOutput,
  resolveSessionId
} from './normalizers'

const CONTROLLED_HISTORY_LIMIT = 6
const CONTROLLED_CONTEXT_UTTERANCE_LIMIT = 4

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

        let responseLocale: string | undefined
        const actionArguments = { ...selected.arguments }
        if (input.response_locale_parameter) {
          const parameterName = input.response_locale_parameter
          const skillConfig = await SkillDomainHelper.getNewSkillConfig(skillName)
          const actions = skillConfig?.actions as Record<string, {
            parameters?: Record<string, { enum?: string[] }>
          }> | undefined
          const allowedLocales = actions?.[selected.name]?.parameters?.[parameterName]?.enum
          const selectedLocale = actionArguments[parameterName]
          if (typeof selectedLocale !== 'string' || !allowedLocales?.includes(selectedLocale)) {
            throw new Error('The controlled action did not select a declared reply locale.')
          }
          responseLocale = selectedLocale
          // Locale metadata must never reach the host's device-action schema.
          delete actionArguments[parameterName]
        }
        const action = {
          name: selected.name,
          input: actionArguments
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
          await NLUProcessResultUpdater.update({ skillName }, responseLocale)
          await NLUProcessResultUpdater.update({ actionName: action.name }, responseLocale)
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
              agentResponseTrace: deserializeAgentTrace(trace)
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
