import type {
  ToolExecutionInput,
  ToolExecutionResult,
  ToolRuntimeProgress
} from '@/core/tool-executor'

export const SATELLITE_PROTOCOL_VERSION = 1

export const SATELLITE_EVENTS = {
  init: 'leon:satellite:init',
  ready: 'leon:satellite:ready',
  invokeTool: 'leon:satellite:invoke-tool',
  toolProgress: 'leon:satellite:tool-progress',
  toolResult: 'leon:satellite:tool-result',
  error: 'leon:satellite:error'
} as const

export interface SatelliteToolDefinition {
  tool_id: string
  toolkit_id: string
  name: string
  description: string
  icon_name?: string
  execution?: {
    provider: string
  }
  functions: Record<
    string,
    {
      description: string
      parameters: Record<string, unknown>
      output_schema?: Record<string, unknown>
    }
  >
}

export interface SatelliteToolkitDefinition {
  id: string
  name: string
  description: string
  icon_name: string
  context_files?: string[]
  tools: Record<string, SatelliteToolDefinition>
}

export interface SatelliteDescriptor {
  id: string
  name: string
  platform: string
  version?: string
}

export interface SatelliteInitPayload {
  protocolVersion: number
  token?: string
  device: SatelliteDescriptor
  toolkits: SatelliteToolkitDefinition[]
}

export interface SatelliteToolInvocation {
  invocationId: string
  input: ToolExecutionInput
  conversationSessionId?: string
}

export interface SatelliteToolProgressPayload {
  invocationId: string
  progress: ToolRuntimeProgress
}

export interface SatelliteToolResultPayload {
  invocationId: string
  result: ToolExecutionResult
}

export interface SatelliteErrorPayload {
  code: string
  message: string
}
