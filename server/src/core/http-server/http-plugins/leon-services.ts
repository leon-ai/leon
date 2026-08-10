import { performance } from 'node:perf_hooks'

import { BRAIN, CONVERSATION_LOGGER, LLM_MANAGER, NLU } from '@/core'
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
import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'

import type {
  HTTPPluginAppendConversationMessageInput,
  HTTPPluginAppendConversationMessageResult,
  HTTPPluginLeonServices,
  HTTPPluginRunControlledSkillInput,
  HTTPPluginRunControlledSkillResult,
  HTTPPluginRunAgentInput,
  HTTPPluginRunAgentResult,
  HTTPPluginToolCall
} from './types'

const CONTROLLED_HISTORY_LIMIT = 6
const CONTROLLED_CONTEXT_UTTERANCE_LIMIT = 4

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
    .map((item): HTTPPluginToolCall | null => {
      if (!item || typeof item !== 'object') {
        return null
      }

      const record = item as Record<string, unknown>
      const name = getStringField(record, 'function')

      if (!name) {
        return null
      }

      const toolCall: HTTPPluginToolCall = {
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

    if (!query) {
      throw new Error('A controlled-skill query is required.')
    }
    if (!skillName) {
      throw new Error('A controlled skill name is required.')
    }

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

        if (answer) {
          const answerPersistenceStartedAt = performance.now()
          await CONVERSATION_LOGGER.upsert(
            {
              who: 'leon',
              message: answer,
              isAddedToHistory: true,
              ...(input.request_id
                ? { messageId: `${input.request_id}:leon` }
                : {})
            },
            { sessionId }
          )
          persistenceMs += elapsedMilliseconds(answerPersistenceStartedAt)
        }

        return {
          answer,
          tier: 'leon-controlled' as const,
          matched: true,
          status: 'success' as const,
          action,
          profile_id: getActiveProfileName(),
          session_id: sessionId,
          request_id: input.request_id || null,
          metrics: {
            ...baseMetrics,
            total_duration_ms: elapsedMilliseconds(totalStartedAt),
            action_execution_ms: actionExecutionMs,
            persistence_ms: Number(persistenceMs.toFixed(2))
          }
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
    await ensureActiveProfileRuntime()
    const query = input.query.trim()
    const sessionId = resolveSessionId(input)
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
          allowDirectAnswerHandoff: input.allow_direct_answer_handoff === true
        })

        await duty.init()
        const dutyResult = await duty.execute()
        const output = dutyResult?.output as unknown

        if (typeof output === 'string' && output.trim()) {
          await CONVERSATION_LOGGER.upsert(
            {
              who: 'leon',
              message: output,
              isAddedToHistory: true,
              ...(input.request_id
                ? { messageId: `${input.request_id}:leon` }
                : {})
            },
            { sessionId }
          )
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
      metrics: data['llmMetrics'] || null
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
    appendConversationMessage
  }
}
