import type { Artifact } from '../../../../server/src/core/artifacts/artifact-types'
import type { ContextUsageMetrics } from '../../../../server/src/core/llm-manager/llm-usage/context-usage'
import type { UsageAccounting } from '../../../../server/src/core/llm-manager/llm-usage/usage-accounting'
import type { AgentProgressMessage } from '../../../../server/src/core/llm-manager/agent-progress-contract'
import type { InferenceActivity, TurnTiming } from '../../../../server/src/core/llm-manager/turn-timing-contract'
import type { FeedPlanStepStatus, FeedToolCallStatus, JsonValue } from './feed'
import type { ConversationSession } from './sessions'
import type { ModelSettings, ModelProvider } from './model-catalog'

export interface ConversationTool {
  planStepId?: string | null
  id: string
  name: string
  status: FeedToolCallStatus
  toolCallTitle?: string
  toolkitName?: string
  toolName?: string
  toolIconName?: string
  toolkitIconName?: string
  startedAt?: number
  preparationStartedAt?: number
  durationMs?: number
  stepLabel?: string
  input?: JsonValue
  output?: JsonValue
  commandOutput?: string
  errorMessage?: string
}

export interface ConversationMetrics extends Partial<ContextUsageMetrics> {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  tokensPerSecond?: number
  averagedPhaseTokensPerSecond?: number
  completionCount?: number
  usageAccounting?: Partial<UsageAccounting> | undefined
  durationMs?: number
  reviewCount?: number
  reviewRetryCount?: number
  reviewDurationMs?: number
  modelProcessingDurationMs?: number
  otherProcessingDurationMs?: number
  phaseMetrics?: { final_answer?: { durationMs?: number } }
}

export interface ConversationTrace {
  answerStartedAt?: number
  timings?: TurnTiming[]
  id?: string
  reasoningSummary?: string
  reasoning?: { id: string, text: string, phase: string, startedAt: number, planStepId?: string | null }[]
  progressMessages?: AgentProgressMessage[]
  planSteps: { id: string, label: string, status: FeedPlanStepStatus }[]
  planTransitions?: { id: string, label: string, status: FeedPlanStepStatus, changedAt: number }[]
  toolCalls: ConversationTool[]
  inferences?: {
    attemptId?: string
    duty?: string
    usagePurpose?: string
    startedAt: number
    elapsedMs: number
    outcome?: string
    phase: string
    retryDecision?: 'retry' | 'stop'
  }[]
  metrics?: ConversationMetrics
}

export interface ConversationRecord {
  fyi?: import('../../../../server/src/core/fyi/fyi-contract').Fyi
  who: 'owner' | 'leon'
  messageId: string
  message: string
  sentAt: number
  isAddedToHistory: boolean
  agentResponseTrace?: ConversationTrace
  llmMetrics?: ConversationMetrics
  artifacts?: Artifact[]
  widget?: {
    widget: string
    componentTree?: Record<string, unknown>
    fallbackText?: string
    activity?: InferenceActivity
  } | null
  draftGeneration?: string
  historical?: boolean
}

export interface ModelSelection {
  provider: string | null
  model: string
  target: string
  settings: ModelSettings
}

export interface ModelCatalog {
  providers: readonly ModelProvider[]
  selection: ModelSelection
  defaults: Record<string, ModelSettings>
}

export interface ConversationCommand {
  id: string
  status: 'accepted' | 'completed' | 'stopped' | 'error' | 'interrupted'
}

export interface ConversationPage {
  session: ConversationSession
  messages: ConversationRecord[]
  next_cursor: string | null
  newer_cursor: string | null
  event_cursor: number
  is_running: boolean
  command: ConversationCommand | null
  selection: ModelSelection
}

export interface ConversationEvent {
  type: string
  sequence: number
  session_id: string
  turn_id: string | null
  response_id: string | null
  created_at: number
  data: Record<string, unknown>
}

export type ConversationNotification = ConversationEvent | { type: 'sessions_changed' }
