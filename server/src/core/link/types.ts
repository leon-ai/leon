import type {
  ToolExecutionInput,
  ToolExecutionResult,
  ToolRuntimeProgress
} from '@/core/tool-executor'

export const LINK_PROTOCOL_VERSION = 1

export const LINK_EVENTS = {
  init: 'leon:link:init',
  ready: 'leon:link:ready',
  invokeTool: 'leon:link:invoke-tool',
  toolProgress: 'leon:link:tool-progress',
  toolResult: 'leon:link:tool-result',
  error: 'leon:link:error'
} as const

export interface LinkToolDefinition {
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

export interface LinkToolkitDefinition {
  id: string
  name: string
  description: string
  icon_name: string
  context_files?: string[]
  tools: Record<string, LinkToolDefinition>
}

export interface LinkDescriptor {
  id: string
  name: string
  platform: string
  version?: string
}

export interface LinkInitPayload {
  protocolVersion: number
  token?: string
  device: LinkDescriptor
  toolkits: LinkToolkitDefinition[]
}

export interface LinkToolInvocation {
  invocationId: string
  input: ToolExecutionInput
}

export interface LinkToolProgressPayload {
  invocationId: string
  progress: ToolRuntimeProgress
}

export interface LinkToolResultPayload {
  invocationId: string
  result: ToolExecutionResult
}

export interface LinkErrorPayload {
  code: string
  message: string
}
