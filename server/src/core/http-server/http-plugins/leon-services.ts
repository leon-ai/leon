import { LLM_MANAGER } from '@/core'
import type { LLMDutyResult } from '@/core/llm-manager/llm-duty'
import { ReActLLMDuty } from '@/core/llm-manager/llm-duties/react-llm-duty'
import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { ensureActiveProfileRuntime } from '@/core/profile-runtime/initialize-profile-runtime'
import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'

import type {
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

async function runAgent(
  input: HTTPPluginRunAgentInput
): Promise<HTTPPluginRunAgentResult> {
  await ensureActiveProfileRuntime()
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
      const duty = new ReActLLMDuty({
        input: input.query.trim(),
        allowDirectAnswerHandoff: input.allow_direct_answer_handoff === true
      })

      await duty.init()
      return duty.execute()
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
}

export function createHTTPPluginLeonServices(): HTTPPluginLeonServices {
  return {
    get profileId(): string {
      return getActiveProfileName()
    },
    isLLMEnabled: () => LLM_MANAGER.isLLMEnabled,
    runAgent
  }
}
