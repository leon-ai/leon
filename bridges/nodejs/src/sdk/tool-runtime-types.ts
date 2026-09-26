import type { ToolModelFile } from './base-tool'

export type { ToolModelFile } from './base-tool'

export interface ToolRuntimeProgress {
  source: 'log' | 'report'
  message: string
  key?: string
  data?: Record<string, unknown>
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
  leonService?: { baseURL: string; token: string }
  signal?: AbortSignal
  onProgress?: (progress: ToolRuntimeProgress) => void
}

export interface ToolRuntimeResult {
  success: boolean
  message: string
  output: Record<string, unknown>
  modelFiles?: ToolModelFile[]
}
