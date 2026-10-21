/**
 * A tool-produced attachment made available to the agent model.
 */
export interface ToolModelFile {
  dataBase64: string
  mediaType: string
  filename?: string
  visualDetail?: 'auto' | 'low' | 'high'
}

/**
 * Tool-owned context that may be referenced again while its complete content
 * remains visible in the model transcript. Raw tool results retain the text.
 */
export interface ReusableToolContext {
  modelContextId: string
  content: string
}

export const MAX_TOOL_TIMEOUT_MS = 2_147_483_647

/**
 * Function-owned execution limits; omitted limits impose no additional cutoff.
 */
export interface ToolTimeoutPolicy {
  idleMs?: number
  totalMs?: number
}

export interface ToolRuntimeProgress {
  source: 'log' | 'report'
  message: string
  key?: string
  data?: Record<string, unknown>
  /**
   * Actual output or advancing work, never a heartbeat or repeated status.
   */
  activity?: boolean
  /**
   * Keeps progress attached to its originating call until retained work ends.
   */
  stream?: { id: string, state: 'running' | 'completed' | 'failed' }
}

/**
 * Host-supplied context; model arguments cannot change the owning profile or session.
 */
export interface ToolExecutionContext {
  toolkitId: string
  toolId: string
  functionName: string
  parameters: Record<string, unknown>
  profileName: string
  conversationSessionId: string | null
  /**
   * Profile-scoped secrets declared by this tool's connection requirements.
   */
  connections?: Record<string, Record<string, unknown>>
  leonService?: { baseURL: string, token: string }
  signal?: AbortSignal
  timeout?: ToolTimeoutPolicy
  onProgress?: (progress: ToolRuntimeProgress) => void
}

export interface ToolRuntimeResult {
  success: boolean
  message: string
  output: Record<string, unknown>
  modelFiles?: ToolModelFile[]
}

/**
 * Internal worker retention policy; ordinary SDK tools run once by default.
 */
export enum ToolRuntimeLifetime {
  Call = 'call',
  Persistent = 'persistent'
}

export type ToolWorkerRequest =
  | { type: 'execute', requestId: string, context: Omit<ToolExecutionContext, 'onProgress' | 'signal'>, args: unknown[] }
  | { type: 'shutdown' }
  | { type: 'cancel', requestId: string, reason: string }

export type ToolWorkerResponse = {
  type: 'result'
  lifetime: ToolRuntimeLifetime
  result: ToolRuntimeResult
} | { type: 'progress', requestId: string, progress: ToolRuntimeProgress }
