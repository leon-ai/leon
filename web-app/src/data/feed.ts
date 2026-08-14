export type FeedPlanStepStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'error'

export type FeedToolCallStatus = 'running' | 'success' | 'error'

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

// Preserve agent-loop chronology by representing each phase as its own node.
// In particular, later reasoning must create another thinking activity.
export type LeonFeedActivity =
  | FeedThinkingActivity
  | FeedSummaryActivity
  | FeedPlanActivity
  | FeedToolsActivity

export interface OwnerFeedEntry {
  id: string
  role: 'owner'
  content: string
}

export interface LeonFeedEntry {
  id: string
  role: 'leon'
  activities: LeonFeedActivity[]
  finalAnswer: string
  bonusResponse?: string
}

export type FeedEntry = OwnerFeedEntry | LeonFeedEntry
