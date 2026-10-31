// This metadata contract is shared with browser clients and must remain dependency-free.
export enum TurnPhase {
  Turn = 'turn',
  Runtime = 'runtime-initialization',
  Attachments = 'attachments',
  History = 'history-loading',
  Catalog = 'catalog-loading',
  Context = 'context-preparation',
  Duty = 'duty-initialization',
  Construction = 'duty-construction',
  Lifecycle = 'inference-lifecycle',
  Execution = 'agent-execution',
  Provider = 'provider-resolution',
  Request = 'model-request',
  Wait = 'provider-wait',
  Stream = 'response-stream',
  Session = 'session-resolution',
  Tools = 'tool-selection',
  ToolSchemas = 'tool-schema-loading',
  ToolRequest = 'tool-request',
  Skill = 'skill-loading',
  Plan = 'plan-update',
  Clarification = 'clarification',
  Cancellation = 'cancellation',
  Connection = 'connection-setup',
  Answer = 'answer-generation',
  Review = 'review',
  Inspection = 'image-inspection',
  Compaction = 'context-compaction',
  Tool = 'tool-execution',
  Validation = 'tool-validation',
  Worker = 'worker-execution',
  Owner = 'owner-message-persistence',
  Persistence = 'response-persistence'
}

export interface TurnTiming {
  id: string
  parentId?: string
  kind: 'phase' | 'inference'
  goal: string
  startedAt: number
  durationMs: number
  outcome: string
  duty?: string
  purpose?: string
  provider?: string
  model?: string
  firstOutputMs?: number
}
