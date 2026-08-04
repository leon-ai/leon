import { CONVERSATION_LOGGER, LLM_MANAGER } from '@/core'
import type { LLMDutyResult } from '@/core/llm-manager/llm-duty'
import { ReActLLMDuty } from '@/core/llm-manager/llm-duties/react-llm-duty'
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
  HTTPPluginRunAgentInput,
  HTTPPluginRunAgentResult,
  HTTPPluginToolCall
} from './types'

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
    const requestedSession = input.session_id
      ? CONVERSATION_SESSION_MANAGER.getSession(input.session_id)
      : null
    const createdSession = !requestedSession && input.create_session === true
      ? CONVERSATION_SESSION_MANAGER.createSession()
      : null
    const sessionId = requestedSession?.id || createdSession?.id ||
      CONVERSATION_SESSION_MANAGER.getActiveSessionId()
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
    appendConversationMessage
  }
}
