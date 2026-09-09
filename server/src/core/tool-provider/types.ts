import type { ToolModelFile } from '@sdk/base-tool'
import type { ToolRuntimeProgress } from '@/core/tool-executor'

export interface ToolProviderExecutionInput {
  toolkitId: string
  toolId: string
  functionName: string
  parameters: Record<string, unknown>
  profileName: string
  conversationSessionId: string | null
  onProgress?: (progress: ToolRuntimeProgress) => void
}

export interface ToolProviderExecutionResult {
  success: boolean
  message: string
  output: Record<string, unknown>
  modelFiles?: ToolModelFile[]
}

export type { ToolModelFile as ToolProviderModelFile } from '@sdk/base-tool'

/** A long-lived runtime used by tools whose state must span agent actions. */
export interface ToolProvider {
  readonly id: string
  execute(input: ToolProviderExecutionInput): Promise<ToolProviderExecutionResult>
  dispose(): Promise<void>
}
