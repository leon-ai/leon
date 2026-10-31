import type { Artifact } from '../../../../server/src/core/artifacts/artifact-types'
import type { TurnTiming } from '../../../../server/src/core/llm-manager/turn-timing-contract'
import type { FeedPlanStepStatus, FeedToolCallStatus, JsonValue } from './feed'
import type { ConversationSession } from './sessions'
import type { ModelSettings, ModelProvider } from './model-catalog'

export interface ConversationTool {
  id: string
  name: string
  status: FeedToolCallStatus
  toolCallTitle?: string
  toolkitName?: string
  toolName?: string
  toolIconName?: string
  startedAt?: number
  preparationStartedAt?: number
  durationMs?: number
  stepLabel?: string
  input?: JsonValue
  output?: JsonValue
  commandOutput?: string
  errorMessage?: string
}

export interface ConversationMetrics {
  durationMs?: number
  reviewCount?: number
  reviewRetryCount?: number
  reviewDurationMs?: number
  modelProcessingDurationMs?: number
  otherProcessingDurationMs?: number
  phaseMetrics?: { final_answer?: { durationMs?: number } }
}

export interface ConversationTrace {
  timings?: TurnTiming[]
  id?: string
  reasoningSummary?: string
  reasoning?: { id: string, text: string, phase: string, startedAt: number }[]
  progressMessages?: { id: string, content: string, createdAt: number }[]
  planSteps: { id: string, label: string, status: FeedPlanStepStatus }[]
  planTransitions?: { id: string, label: string, status: FeedPlanStepStatus, changedAt: number }[]
  toolCalls: ConversationTool[]
  inferences?: {
    attemptId?: string
    duty?: string
    usagePurpose?: string
    startedAt: number
    elapsedMs: number
    phase: string
    retryDecision?: 'retry' | 'stop'
  }[]
  metrics?: ConversationMetrics
}

export interface ConversationRecord {
  who: 'owner' | 'leon'
  messageId: string
  message: string
  sentAt: number
  isAddedToHistory: boolean
  agentResponseTrace?: ConversationTrace
  llmMetrics?: ConversationMetrics
  artifacts?: Artifact[]
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
