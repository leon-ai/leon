import type { Artifact } from '../../../../server/src/core/artifacts/artifact-types'

export enum FeedTurnStatus {
  InProgress = 'in_progress',
  Completed = 'completed'
}

export type FeedPlanStepStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'error'

export type FeedToolCallStatus = 'preparing' | 'running' | 'success' | 'error'

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

interface FeedActivityTime {
  planStepId?: string | null | undefined
  startedAt?: number | undefined
}

export interface FeedToolCall extends FeedActivityTime {
  preparationStartedAt?: number | undefined
  id: string
  toolCallTitle: string
  toolkitName: string
  toolName: string
  toolIconName: string
  functionName: string
  status: FeedToolCallStatus
  durationMs?: number
  input: JsonValue
  output?: JsonValue
}

/**
 * Keeps untitled argument previews behind the group's preparation status.
 * Executed or finished calls remain inspectable even without an action title.
 */
export function isToolCallVisible(toolCall: FeedToolCall): boolean {
  return toolCall.status !== 'preparing' || toolCall.toolCallTitle.trim().length > 0
}

export interface FeedPlanStep {
  id: string
  label: string
  status: FeedPlanStepStatus
  toolCalls: FeedToolCall[]
  activities?: LeonFeedActivity[]
  startedAt?: number | undefined
}

export interface FeedThinkingActivity extends FeedActivityTime {
  id: string
  type: 'thinking'
  details: string[]
  durationMs: number | undefined
  isActive: boolean
}

export interface FeedSummaryActivity extends FeedActivityTime {
  id: string
  type: 'summary'
  content: string
}

export interface FeedPlanActivity extends FeedActivityTime {
  id: string
  type: 'plan'
  steps: FeedPlanStep[]
  complete?: boolean
  durationMs?: number | undefined
}

export interface FeedToolsActivity extends FeedActivityTime {
  id: string
  type: 'tools'
  toolCalls: FeedToolCall[]
}

export interface FeedWorkingActivity extends FeedActivityTime {
  id: string
  type: 'working'
  label?: string
}

export interface FeedReviewActivity extends FeedActivityTime {
  id: string
  type: 'review'
  durationMs: number
}

export interface FeedAnswerActivity extends FeedActivityTime {
  id: string
  type: 'answer'
  durationMs: number
}

export interface FeedRetryActivity extends FeedActivityTime {
  id: string
  type: 'retry'
  count: number
}

export interface FeedOtherProcessingActivity extends FeedActivityTime {
  id: string
  type: 'other'
  durationMs: number
}

export interface FeedModelProcessingActivity extends FeedActivityTime {
  id: string
  type: 'processing'
  durationMs: number
  isActive?: boolean
  inline?: boolean
  requests?: {
    id: string
    label: string
    iconName: string
    durationMs: number
    isActive?: boolean
    activeLabel?: string
    startedAt?: number | undefined
    planStepId?: string | null | undefined
  }[]
}

// Preserve agent-loop chronology by representing each phase as its own node.
// In particular, later reasoning must create another thinking activity.
export type LeonFeedActivity =
  | FeedWorkingActivity
  | FeedThinkingActivity
  | FeedSummaryActivity
  | FeedPlanActivity
  | FeedToolsActivity
  | FeedReviewActivity
  | FeedAnswerActivity
  | FeedRetryActivity
  | FeedOtherProcessingActivity
  | FeedModelProcessingActivity

export interface OwnerFeedEntry {
  sentAt?: number | undefined
  id: string
  role: 'owner'
  content: string
}

export interface LeonFeedEntry {
  answerStartedAt?: number | undefined
  answerGenerationId?: string
  artifacts?: Artifact[]
  id: string
  role: 'leon'
  status: FeedTurnStatus
  // Whole-turn wall-clock time, not a sum of overlapping activity durations.
  durationMs: number
  activities: LeonFeedActivity[]
  finalAnswer: string
  bonusResponse?: string
}

export type FeedEntry = OwnerFeedEntry | LeonFeedEntry
