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

export interface FeedToolCall {
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

export interface FeedPlanStep {
  id: string
  label: string
  status: FeedPlanStepStatus
  toolCalls: FeedToolCall[]
}

export interface FeedThinkingActivity {
  id: string
  type: 'thinking'
  details: string[]
  durationMs: number
  isActive: boolean
}

export interface FeedSummaryActivity {
  id: string
  type: 'summary'
  content: string
}

export interface FeedPlanActivity {
  id: string
  type: 'plan'
  steps: FeedPlanStep[]
}

export interface FeedToolsActivity {
  id: string
  type: 'tools'
  toolCalls: FeedToolCall[]
}

export interface FeedWorkingActivity {
  id: string
  type: 'working'
}

export interface FeedReviewActivity {
  id: string
  type: 'review'
  durationMs: number
}

export interface FeedAnswerActivity {
  id: string
  type: 'answer'
  durationMs: number
}

export interface FeedRetryActivity {
  id: string
  type: 'retry'
  count: number
}

export interface FeedOtherProcessingActivity {
  id: string
  type: 'other'
  durationMs: number
}

export interface FeedModelProcessingActivity {
  id: string
  type: 'processing'
  durationMs: number
  requests?: {
    id: string
    label: string
    iconName: string
    durationMs: number
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
  id: string
  role: 'owner'
  content: string
}

export interface LeonFeedEntry {
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
