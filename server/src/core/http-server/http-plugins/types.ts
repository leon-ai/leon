import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import type { APIOptions } from '@/core/http-server/http-server'

export interface HTTPPluginAuthConfig {
  enabled: boolean
  token: string
}

export interface HTTPPluginRuntimeConfig {
  enabled: boolean
  allowRootRoutes: boolean
  auth: HTTPPluginAuthConfig
}

export interface HTTPPluginRunAgentInput {
  query: string
  /** Trusted turn-level guidance supplied by the installed HTTP plugin. */
  additionalInstructions?: string
  profile_id?: string
  session_id?: string
  create_session?: boolean
  allow_direct_answer_handoff?: boolean
  request_id?: string
  metadata?: Record<string, unknown>
}

export interface HTTPPluginToolCall {
  name: string
  status: 'success' | 'error'
  observation?: string
  step_label?: string
  input?: unknown
}

export interface HTTPPluginRunAgentResult {
  answer: string
  tier: 'leon-react'
  tool_calls: HTTPPluginToolCall[]
  profile_id: string
  session_id: string | null
  request_id: string | null
  final_intent: string | null
  metrics: unknown
}

export interface HTTPPluginRunControlledSkillInput {
  query: string
  skill_name: string
  /** An explicit native action that hands the request back to the caller. */
  fallback_action_name?: string
  profile_id?: string
  session_id?: string
  create_session?: boolean
  request_id?: string
}

export interface HTTPPluginControlledAction {
  name: string
  input: Record<string, unknown>
}

export interface HTTPPluginControlledSkillMetrics {
  total_duration_ms: number
  profile_activation_ms: number
  history_load_ms: number
  inference_duration_ms: number
  action_execution_ms: number
  persistence_ms: number
  input_tokens: number
  output_tokens: number
}

export interface HTTPPluginRunControlledSkillResult {
  answer: string
  tier: 'leon-controlled'
  matched: boolean
  status: 'success' | 'not_found' | 'missing_parameters' | 'error'
  action: HTTPPluginControlledAction | null
  profile_id: string
  session_id: string | null
  request_id: string | null
  metrics: HTTPPluginControlledSkillMetrics
}

export interface HTTPPluginAppendConversationMessageInput {
  profile_id?: string
  session_id: string
  role: 'owner' | 'assistant'
  message: string
  message_id?: string
}

export interface HTTPPluginAppendConversationMessageResult {
  profile_id: string
  session_id: string
  role: 'owner' | 'assistant'
  message_id: string | null
}

export interface HTTPPluginLeonServices {
  readonly profileId: string
  isLLMEnabled: () => boolean
  runAgent: (
    input: HTTPPluginRunAgentInput
  ) => Promise<HTTPPluginRunAgentResult>
  runControlledSkill: (
    input: HTTPPluginRunControlledSkillInput
  ) => Promise<HTTPPluginRunControlledSkillResult>
  appendConversationMessage: (
    input: HTTPPluginAppendConversationMessageInput
  ) => Promise<HTTPPluginAppendConversationMessageResult>
}

export type HTTPPluginSourceScope = 'global' | 'profile'

export interface HTTPPluginRouteContext extends APIOptions {
  plugin: HTTPPluginRuntimeConfig
  leon: HTTPPluginLeonServices
}

export interface HTTPPluginDefinition {
  id: string
  name: string
  version: string
  description: string
  register: (
    fastify: FastifyInstance,
    context: HTTPPluginRouteContext
  ) => Promise<void>
}

export interface HTTPPluginManifest {
  id: string
  name?: string
  version?: string
  description?: string
  entry?: string
}

export interface DiscoveredHTTPPluginDefinition {
  definition: HTTPPluginDefinition
  source: HTTPPluginSourceScope
  path?: string
}

export type HTTPPluginRequest = FastifyRequest
export type HTTPPluginReply = FastifyReply
