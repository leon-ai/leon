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

export interface FeedThinking {
  details: string[]
  durationMs: number
  isActive: boolean
}

export interface OwnerFeedEntry {
  id: string
  role: 'owner'
  content: string
}

export interface LeonFeedEntry {
  id: string
  role: 'leon'
  thinking: FeedThinking
  summary: string
  finalAnswer: string
  plan?: FeedPlanStep[]
  toolCalls?: FeedToolCall[]
}

export type FeedEntry = OwnerFeedEntry | LeonFeedEntry
