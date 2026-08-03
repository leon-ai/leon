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

export interface HTTPPluginLeonServices {
  readonly profileId: string
  isLLMEnabled: () => boolean
  runAgent: (
    input: HTTPPluginRunAgentInput
  ) => Promise<HTTPPluginRunAgentResult>
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
