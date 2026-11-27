// This metadata contract is shared with browser clients and must remain dependency-free.
export const OWNER_TURN_FAILURE_CODES = ['timeout', 'connection', 'rate_limit', 'authorization', 'no_output', 'unknown'] as const
export type OwnerTurnFailureCode = typeof OWNER_TURN_FAILURE_CODES[number]
export type OwnerTurnOutcome = 'answered' | 'clarification' | 'blocked' | 'failed' | 'canceled'

export enum TurnPhase {
  Turn = 'turn',
  PostTurn = 'post-turn',
  OwnerRewrite = 'owner-profile-rewrite',
  OwnerRepair = 'owner-profile-repair',
  OwnerVerification = 'owner-profile-verification',
  OwnerCompaction = 'owner-profile-compaction',
  OwnerExtraction = 'owner-profile-extraction',
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
  MCPConnection = 'mcp-connection',
  MCPDiscovery = 'mcp-discovery',
  CatalogSearch = 'catalog-search',
  VisualSetup = 'visual-setup',
  Visual = 'visual-generation',
  VisualPresentation = 'visual-presentation',
  Answer = 'answer-generation',
  Review = 'review',
  Inspection = 'image-inspection',
  Compaction = 'context-compaction',
  Tool = 'tool-execution',
  Validation = 'tool-validation',
  Worker = 'worker-execution',
  Owner = 'owner-message-persistence',
  Persistence = 'response-persistence',
  Delivery = 'response-publishing'
}

export enum TurnStage {
  PreTurn = 'pre-turn',
  AgentLoop = 'agent-loop',
  PostTurn = 'post-turn'
}

export const OWNER_FAILURE_PHASES = [
  TurnPhase.Runtime, TurnPhase.Session, TurnPhase.Attachments, TurnPhase.Owner,
  TurnPhase.History, TurnPhase.Catalog, TurnPhase.Context, TurnPhase.Duty, TurnPhase.Construction, TurnPhase.Provider,
  TurnPhase.Execution, TurnPhase.Request, TurnPhase.Tool, TurnPhase.Validation, TurnPhase.Worker,
  TurnPhase.Skill, TurnPhase.MCPConnection, TurnPhase.MCPDiscovery, TurnPhase.Compaction, TurnPhase.Answer,
  TurnPhase.Review, TurnPhase.Persistence, TurnPhase.Delivery
] as const
export type OwnerFailurePhase = typeof OWNER_FAILURE_PHASES[number]
export const INFERENCE_FAILURE_CODES = [
  'timeout', 'connection', 'connection_refused', 'rate_limit', 'authorization',
  'context_limit', 'provider_unavailable', 'provider_startup', 'model_load',
  'empty_response', 'provider_error'
] as const
export type InferenceFailureCode = typeof INFERENCE_FAILURE_CODES[number]

export const TURN_DIAGNOSTIC_CODES = [
  ...OWNER_TURN_FAILURE_CODES, 'blocked', 'error_response', 'context_limit', 'provider_unavailable', 'provider_error',
  'tool_failed', 'tool_settings_missing', 'review_invalid_response',
  'connection_refused', 'provider_startup', 'model_load', 'empty_response'
] as const
export type TurnDiagnosticCode = typeof TURN_DIAGNOSTIC_CODES[number]

/**
 * Resolves failures to a known phase without using a tool, skill, or session name.
 */
export function getOwnerFailurePhase(phase: string): OwnerFailurePhase {
  return OWNER_FAILURE_PHASES.find((value) => value === phase) ?? TurnPhase.Execution
}

export interface TurnTimingContext {
  turnId: string
  stage: TurnStage
  taskId?: string
  task?: string
}

export interface TurnTiming {
  /**
   * Captured at activity start. Null means turn-level work; omission means unknown.
   */
  planStepId?: string | null
  stage?: TurnStage
  id: string
  parentId?: string
  kind: 'phase' | 'inference'
  goal: string
  subject?: string
  startedAt: number
  durationMs: number
  outcome: string
  failureCode?: TurnDiagnosticCode
  duty?: string
  purpose?: string
  provider?: string
  model?: string
  firstOutputMs?: number
  firstCompactionMs?: number
  compactionCount?: number
  compactionDurationMs?: number
  usageId?: string
  usage?: import('../../llm-manager/llm-usage/usage-accounting').InferenceUsage
}

// The event name remains compatible with saved clients; kind distinguishes
// measured preparation from provider inference and token accounting.
export type InferenceActivity = Pick<TurnTiming, 'id' | 'goal' | 'subject' | 'startedAt' | 'durationMs' | 'outcome' | 'planStepId'> & {
  kind?: TurnTiming['kind']
}

/**
 * Selects runtime preparation that deserves a visible, measured activity.
 */
export function isToolPreparationPhase(goal: string): boolean {
  return goal === TurnPhase.MCPConnection || goal === TurnPhase.MCPDiscovery
}
