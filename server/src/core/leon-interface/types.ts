import type { RoutingMode } from '@/types'
import type { AgentModelFile, CompletionFailureKind } from '@/core/llm-manager/types'
import type { ContextUsageMetrics } from '@/core/llm-manager/llm-usage/context-usage'

export const LEON_CLIENT_INTERFACE_PROTOCOL_VERSION = 1

export const LEON_CLIENT_INTERFACE_EVENTS = {
  init: 'leon:init',
  utterance: 'leon:utterance',
  ready: 'leon:ready',
  answer: 'leon:answer',
  isTyping: 'leon:is-typing',
  suggest: 'leon:suggest',
  llmToken: 'leon:llm-token',
  llmReasoningToken: 'leon:llm-reasoning-token',
  modelResponseStatus: 'leon:model-response-status',
  toolProgress: 'leon:tool-progress',
  ownerUtterance: 'leon:owner-utterance',
  error: 'leon:error'
} as const

export const LEON_CLIENT_INTERFACE_DEFAULT_CLIENT_TYPE = 'custom'

export type LeonClientInterfaceProtocol = 'legacy' | 'leon_client'

export interface LeonClientCapabilities {
  supportsWidgets: boolean
  supportsTokenStreaming: boolean
  supportsVoice: boolean
}

export interface LeonClientDescriptor {
  id?: string
  type?: string
  name?: string
  version?: string
}

export interface LeonClientInterfaceInitPayload {
  protocolVersion?: number
  client: string | LeonClientDescriptor
  capabilities?: Partial<LeonClientCapabilities>
  sessionId?: string
  token?: string
}

export interface LeonClientInterfaceUtterancePayload {
  value: string
  attachments?: AgentModelFile[]
  conversationId?: string
  messageId?: string
  sentAt?: number
  sessionId?: string
  commandContext?: {
    forcedRoutingMode?: RoutingMode
    forcedSkillName?: string
    forcedToolName?: string
  }
  metadata?: Record<string, unknown>
}

export type LeonClientInterfaceAnswerPayload = Record<string, unknown> | string

export type LeonClientInterfaceTypingPayload = boolean

export enum ModelResponseState {
  Waiting = 'waiting',
  Connected = 'connected',
  Reasoning = 'reasoning',
  Retrying = 'retrying',
  Completed = 'completed'
}

/**
 * Transient request activity without model reasoning content or chat history.
 */
export interface ModelResponseStatus {
  contextUsage?: ContextUsageMetrics
  requestId: string
  sessionId: string
  startedAt: number
  state: ModelResponseState
  attempt?: number
  deadlineAt?: number
  lastActivityAt?: number | null
  retryReason?: CompletionFailureKind | undefined
}

export type LeonClientInterfaceSuggestionsPayload = string[]

export interface LeonClientInterfaceTokenPayload {
  token: string
  generationId: string
  phase?: string
  // Discard provisional text from a rejected response or provider retry.
  reset?: boolean
}

export interface LeonClientInterfaceToolProgressPayload {
  requestId: string
  toolkitId: string | null
  toolId: string
  functionName: string | null
  progress: {
    source: 'log' | 'report'
    message: string
    key?: string
    data?: Record<string, unknown>
  }
}

export interface LeonClientInterfaceErrorPayload {
  code: string
  message: string
  sessionId?: string
}
