import { LLM_MANAGER } from '@/core'
import type { LLMDutyResult } from '@/core/llm-manager/llm-duty'
import { ReActLLMDuty } from '@/core/llm-manager/llm-duties/react-llm-duty'
import { LEON_PROFILE_NAME } from '@/leon-roots'

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
  const duty = new ReActLLMDuty({
    input: input.query.trim()
  })

  await duty.init()
  const result = await duty.execute()
  const data = result?.data || {}
  const output = result?.output as unknown

  return {
    answer: typeof output === 'string' ? output : '',
    tier: 'leon-react',
    tool_calls: normalizeToolCalls(result),
    profile_id: LEON_PROFILE_NAME,
    session_id: input.session_id || null,
    request_id: input.request_id || null,
    final_intent:
      typeof data['finalIntent'] === 'string' ? data['finalIntent'] : null,
    metrics: data['llmMetrics'] || null
  }
}

export function createHTTPPluginLeonServices(): HTTPPluginLeonServices {
  return {
    profileId: LEON_PROFILE_NAME,
    isLLMEnabled: () => LLM_MANAGER.isLLMEnabled,
    runAgent
  }
}
