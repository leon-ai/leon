import { performance } from 'node:perf_hooks'

import type { LLMDutyResult } from '@/core/llm-manager/llm-duty'
import type { ActionCallingOutput } from '@/core/llm-manager/types'
import {
  CONVERSATION_SESSION_MANAGER,
  type ConversationSession
} from '@/core/session-manager'

import type {
  HTTPPluginConversationSession,
  HTTPPluginToolCall
} from '../types'

const DEFAULT_HISTORY_LIMIT = 100
const MAXIMUM_HISTORY_LIMIT = 500

export function elapsedMilliseconds(startedAt: number): number {
  return Number((performance.now() - startedAt).toFixed(2))
}

function getStringField(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === 'string' ? record[key].trim() : ''
}

export function normalizeToolCalls(
  result: LLMDutyResult | null
): HTTPPluginToolCall[] {
  const executionHistory = Array.isArray(result?.data?.['executionHistory'])
    ? result.data['executionHistory']
    : []

  return executionHistory
    .map((item, index): HTTPPluginToolCall | null => {
      if (!item || typeof item !== 'object') return null

      const record = item as Record<string, unknown>
      const name = getStringField(record, 'function')
      if (!name) return null

      const toolCall: HTTPPluginToolCall = {
        id: `tool-${index + 1}`,
        name,
        status: record['status'] === 'error' ? 'error' : 'success'
      }
      const observation = getStringField(record, 'observation')
      const stepLabel = getStringField(record, 'stepLabel')

      if (observation) toolCall.observation = observation
      if (stepLabel) toolCall.step_label = stepLabel
      if (record['requestedToolInput'] !== undefined) {
        toolCall.input = record['requestedToolInput']
      }

      return toolCall
    })
    .filter((item): item is HTTPPluginToolCall => item !== null)
}

export function normalizeOwnerProfileToolExecutions(
  result: LLMDutyResult | null
): Array<{
  functionName: string
  status: 'success' | 'error'
  observation: string
}> {
  const executionHistory = Array.isArray(result?.data?.['executionHistory'])
    ? result.data['executionHistory']
    : []

  return executionHistory
    .map((item) => {
      if (!item || typeof item !== 'object') return null

      const record = item as Record<string, unknown>
      const functionName = getStringField(record, 'function')
      if (!functionName) return null

      return {
        functionName,
        status:
          record['status'] === 'error'
            ? ('error' as const)
            : ('success' as const),
        observation: getStringField(record, 'observation')
      }
    })
    .filter(
      (item): item is {
        functionName: string
        status: 'success' | 'error'
        observation: string
      } => item !== null
    )
}

export function normalizeConversationSession(
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

export function normalizeHistoryLimit(limit?: number): number {
  if (!Number.isInteger(limit) || !limit || limit < 1) {
    return DEFAULT_HISTORY_LIMIT
  }

  return Math.min(limit, MAXIMUM_HISTORY_LIMIT)
}

export function resolveSessionId(input: {
  session_id?: string
  create_session?: boolean
}): string {
  const requestedSession = input.session_id
    ? CONVERSATION_SESSION_MANAGER.getSession(input.session_id)
    : null
  const createdSession =
    !requestedSession && input.create_session === true
      ? CONVERSATION_SESSION_MANAGER.createSession()
      : null

  return (
    requestedSession?.id ||
    createdSession?.id ||
    CONVERSATION_SESSION_MANAGER.getActiveSessionId()
  )
}

export function parseActionCallingOutput(
  result: LLMDutyResult | null
): ActionCallingOutput[] {
  if (!result) return []

  try {
    const output = result.output as unknown
    const parsed = JSON.parse(
      typeof output === 'string' ? output : JSON.stringify(output)
    ) as unknown

    return Array.isArray(parsed) ? (parsed as ActionCallingOutput[]) : []
  } catch {
    return []
  }
}

export function getSkillAnswerText(answer: unknown): string {
  if (typeof answer === 'string') return answer.trim()
  if (!answer || typeof answer !== 'object') return ''

  const answerConfig = answer as Record<string, unknown>
  const text =
    typeof answerConfig['text'] === 'string'
      ? answerConfig['text']
      : answerConfig['speech']

  return typeof text === 'string' ? text.trim() : ''
}
