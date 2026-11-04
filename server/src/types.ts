import type { Artifact } from '@/core/artifacts/artifact-types'
import type { AgentProgressMessage } from '@/core/llm-manager/agent-progress-contract'
/**
 * Contain common/shared types that are universal across the project
 * and cannot be placed in the respective core nodes
 */

/**
 * Language
 */

/**
 * ISO 639-1 (Language codes) - ISO 3166-1 (Country Codes)
 * @see https://www.iso.org/iso-639-language-codes.html
 * @see https://www.iso.org/iso-3166-country-codes.html
 */

import LANG_CONFIGS from '@@/core/langs.json' with { type: 'json' }
import type { UsageAccounting } from '@/core/llm-manager/llm-usage/usage-accounting'
import type { ContextUsageMetrics } from '@/core/llm-manager/llm-usage/context-usage'
import type { TurnInference } from '@/core/llm-manager/inference-metadata'
import type { CompletionAttemptTiming } from '@/core/llm-manager/types'
import type { InferenceActivity } from '@/core/llm-manager/turn-timing-contract'

export type Languages = typeof LANG_CONFIGS
export type LongLanguageCode = keyof Languages
export type Language = Languages[LongLanguageCode]
export type ShortLanguageCode = Language['short']

/**
 * System
 */

export enum OSTypes {
  Windows = 'windows',
  MacOS = 'macos',
  Linux = 'linux',
  Unknown = 'unknown'
}
export enum CPUArchitectures {
  X64 = 'x64',
  ARM64 = 'arm64'
}

/**
 * Stateless tools accept concurrent calls; shared sessions require ordering.
 */
export enum ToolConcurrency {
  Parallel = 'parallel',
  Serial = 'serial'
}

/**
 * Review is required unless a function opts into the single-lookup fast path.
 */
export enum ToolCompletionReview {
  Required = 'required',
  Optional = 'optional'
}

/**
 * Identifies the caller so ambient activity is distinct from agent actions.
 */
export enum ToolExecutionOrigin {
  Agent = 'agent',
  Persona = 'persona'
}

/**
 * Routing mode
 */
export enum RoutingMode {
  Smart = 'smart',
  Controlled = 'controlled',
  Agent = 'agent'
}

/**
 * Skill package format.
 */
export enum SkillFormat {
  LeonNative = 'leon-native',
  AgentSkill = 'agent-skill'
}

/**
 * Ownership of executable guidance, independent of its package format.
 */
export enum SkillOrigin {
  BuiltIn = 'built-in',
  Owner = 'owner-installed',
  Experience = 'experience'
}

/**
 * Mood
 */
export enum Moods {
  Default = 'default',
  Tired = 'tired',
  Sad = 'sad',
  Angry = 'angry',
  Cocky = 'cocky'
}

/**
 * Logger
 */

export type ConversationWidgetHistoryMode = 'persisted' | 'system_widget'
export type ConversationItemSource = 'conversation_history' | 'system_widget'

export interface ConversationWidgetData {
  activity?: InferenceActivity
  actionName: string
  widget: string
  id: string
  componentTree: Record<string, unknown>
  supportedEvents: string[]
  onFetch: {
    widgetId?: string
    actionName: string
  } | null
  fallbackText: string
  historyMode: ConversationWidgetHistoryMode
}

export interface LLMAnswerMetrics extends Partial<ContextUsageMetrics> {
  usageAccounting?: UsageAccounting | undefined
  completionCount?: number
  /**
   * Completion checks exclude retries from their count; their duration includes
   * every attempt and remains part of the overall turn duration.
   */
  reviewCount?: number
  reviewRetryCount?: number
  reviewDurationMs?: number
  /**
   * Wall-clock time outside measured model requests and tool execution intervals.
   */
  otherProcessingDurationMs?: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  finalAnswerOutputTokens?: number
  durationMs: number
  finalAnswerDurationMs?: number
  finalAnswerTokensPerSecond?: number
  finalAnswerCharsPerSecond?: number
  outputCharsPerSecond?: number
  averagedPhaseTokensPerSecond?: number
  phaseMetrics?: {
    agent: { outputTokens: number, durationMs: number, tokensPerSecond: number }
    final_answer: { outputTokens: number, durationMs: number, tokensPerSecond: number }
  }
  turnInputTokens?: number
  turnOutputTokens?: number
  turnTotalTokens?: number
  ttftMs?: number
  tokensPerSecond: number
}

export interface AgentResponsePlanStep {
  id: string
  label: string
  status: 'pending' | 'in_progress' | 'completed' | 'error'
}

export interface AgentResponsePlanTransition extends AgentResponsePlanStep {
  changedAt: number
}

export interface AgentResponseToolCall {
  planStepId?: string | null
  id: string
  preparationStartedAt?: number
  startedAt?: number
  durationMs?: number
  name: string
  toolCallTitle?: string
  toolkitName?: string
  toolName?: string
  status: 'preparing' | 'running' | 'success' | 'error'
  toolkitIconName?: string
  toolIconName?: string
  input?: unknown
  output?: unknown
  commandOutput?: string
  lastOutputAt?: number
  progressMessage?: string
  stepLabel?: string
  errorMessage?: string
  skillId?: string
  nativeSkillPath?: string
}

/**
 * Persisted, user-visible trace for replaying an agent turn.
 */
export interface AgentResponseTrace {
  answerStartedAt?: number
  timings?: import('@/core/llm-manager/turn-timing').TurnTiming[]
  id?: string
  inferences?: (CompletionAttemptTiming & { phase: 'agent' | 'final_answer' | 'review' })[]
  progressMessages?: AgentProgressMessage[]
  reasoning?: {
    id: string
    text: string
    phase: string
    startedAt: number
    planStepId?: string | null
  }[]
  reasoningSummary?: string
  planSteps: AgentResponsePlanStep[]
  planTransitions?: AgentResponsePlanTransition[]
  toolCalls: AgentResponseToolCall[]
  metrics?: Record<string, unknown>
}

export interface MessageLog {
  fyi?: import('@/core/fyi/fyi-contract').Fyi
  inference?: TurnInference
  artifacts?: Artifact[]
  who: 'owner' | 'leon'
  sentAt: number
  message: string
  isAddedToHistory: boolean
  messageId?: string
  widget?: ConversationWidgetData | null
  llmMetrics?: LLMAnswerMetrics
  agentResponseTrace?: AgentResponseTrace
}

export interface ConversationHistoryItem {
  fyi?: import('@/core/fyi/fyi-contract').Fyi
  inference?: TurnInference
  artifacts?: Artifact[]
  widget?: ConversationWidgetData
  who: MessageLog['who']
  sentAt: number
  string: string
  originalString: string
  source: ConversationItemSource
  messageId?: string
  llmMetrics?: LLMAnswerMetrics
  agentResponseTrace?: AgentResponseTrace
}
