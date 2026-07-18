import type { RoutingMode } from '@/types'

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

export type LeonClientInterfaceSuggestionsPayload = string[]

export interface LeonClientInterfaceTokenPayload {
  token: string
  generationId: string
  phase?: string
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
