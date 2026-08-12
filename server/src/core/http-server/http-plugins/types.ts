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
  /** Time spent by the host integration choosing this agent path. */
  router_response_ms?: number
  metadata?: Record<string, unknown>
}

export interface HTTPPluginToolCall {
  id?: string
  name: string
  status: 'running' | 'success' | 'error'
  observation?: string
  step_label?: string
  input?: unknown
  output?: unknown
  error_message?: string
  skill_id?: string
  native_skill_path?: string
}

export interface HTTPPluginPlanStep {
  id: string
  label: string
  status: 'pending' | 'in_progress' | 'completed' | 'error'
}

export interface HTTPPluginAgentTrace {
  reasoning_summary?: string
  plan_steps: HTTPPluginPlanStep[]
  tool_calls: HTTPPluginToolCall[]
  metrics?: Record<string, unknown>
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

export interface HTTPPluginConversationSession {
  id: string
  title: string
  is_pinned: boolean
  created_at: number
  updated_at: number
  last_message_at: number | null
  message_count: number
}

export interface HTTPPluginListConversationSessionsInput {
  profile_id?: string
}

export interface HTTPPluginListConversationSessionsResult {
  profile_id: string
  active_session_id: string
  sessions: HTTPPluginConversationSession[]
}

export interface HTTPPluginConversationMessage {
  role: 'owner' | 'assistant'
  content: string
  created_at: number
  message_id: string | null
  metrics: unknown
  response_trace: HTTPPluginAgentTrace | null
}

export interface HTTPPluginGetConversationHistoryInput {
  profile_id?: string
  session_id: string
  limit?: number
  include_developer_provenance?: boolean
}

export interface HTTPPluginGetConversationHistoryResult {
  profile_id: string
  session_id: string
  messages: HTTPPluginConversationMessage[]
}

export interface HTTPPluginCreateConversationSessionInput {
  profile_id?: string
}

export interface HTTPPluginSelectConversationSessionInput {
  profile_id?: string
  session_id: string
}

export interface HTTPPluginConversationSessionMutationResult {
  profile_id: string
  active_session_id: string
  session: HTTPPluginConversationSession
}

export type HTTPPluginAgentEventType =
  | 'reasoning_summary'
  | 'plan_step'
  | 'tool_call'
  | 'final_answer'
  | 'metrics'
  | 'error'
  | 'session_changed'

export interface HTTPPluginAgentEvent {
  sequence: number
  profile_id: string
  session_id: string
  turn_id: string | null
  response_id: string | null
  created_at: number
  type: HTTPPluginAgentEventType
  data: Record<string, unknown>
}

export interface HTTPPluginSubscribeAgentEventsInput {
  profile_id?: string
  session_id?: string
  after_sequence?: number
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
  listConversationSessions: (
    input: HTTPPluginListConversationSessionsInput
  ) => Promise<HTTPPluginListConversationSessionsResult>
  getConversationHistory: (
    input: HTTPPluginGetConversationHistoryInput
  ) => Promise<HTTPPluginGetConversationHistoryResult>
  createConversationSession: (
    input: HTTPPluginCreateConversationSessionInput
  ) => Promise<HTTPPluginConversationSessionMutationResult>
  selectConversationSession: (
    input: HTTPPluginSelectConversationSessionInput
  ) => Promise<HTTPPluginConversationSessionMutationResult>
  subscribeAgentEvents: (
    input: HTTPPluginSubscribeAgentEventsInput,
    listener: (event: HTTPPluginAgentEvent) => void
  ) => Promise<() => void>
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
