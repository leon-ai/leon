import type {
  ToolExecutionInput,
  ToolExecutionResult,
  ToolRuntimeProgress
} from '@/core/tool-executor'

export const COMPANION_PROTOCOL_VERSION = 1

export const COMPANION_EVENTS = {
  init: 'leon:companion:init',
  ready: 'leon:companion:ready',
  invokeTool: 'leon:companion:invoke-tool',
  toolProgress: 'leon:companion:tool-progress',
  toolResult: 'leon:companion:tool-result',
  error: 'leon:companion:error'
} as const

export interface CompanionToolDefinition {
  tool_id: string
  toolkit_id: string
  name: string
  description: string
  icon_name?: string
  functions: Record<
    string,
    {
      description: string
      parameters: Record<string, unknown>
      output_schema?: Record<string, unknown>
    }
  >
}

export interface CompanionToolkitDefinition {
  id: string
  name: string
  description: string
  icon_name: string
  context_files?: string[]
  tools: Record<string, CompanionToolDefinition>
}

export interface CompanionDescriptor {
  id: string
  name: string
  platform: string
  version?: string
}

export interface CompanionInitPayload {
  protocolVersion: number
  token?: string
  device: CompanionDescriptor
  toolkits: CompanionToolkitDefinition[]
}

export interface CompanionToolInvocation {
  invocationId: string
  input: ToolExecutionInput
}

export interface CompanionToolProgressPayload {
  invocationId: string
  progress: ToolRuntimeProgress
}

export interface CompanionToolResultPayload {
  invocationId: string
  result: ToolExecutionResult
}

export interface CompanionErrorPayload {
  code: string
  message: string
}
