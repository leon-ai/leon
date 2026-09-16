import type {
  ToolExecutionInput,
  ToolExecutionResult,
  ToolRuntimeProgress
} from '@/core/tool-executor'

export const SATELLITE_PROTOCOL_VERSION = 2
// Visual tool results include base64 screenshots, unlike ordinary chat events.
export const SATELLITE_MAX_MESSAGE_BYTES = 16 * 1_024 * 1_024

export const SATELLITE_EVENTS = {
  init: 'leon:satellite:init',
  ready: 'leon:satellite:ready',
  invokeTool: 'leon:satellite:invoke-tool',
  cancelTool: 'leon:satellite:cancel-tool',
  toolProgress: 'leon:satellite:tool-progress',
  toolResult: 'leon:satellite:tool-result',
  context: 'leon:satellite:context',
  error: 'leon:satellite:error'
} as const

export interface SatelliteToolDefinition {
  tool_id: string
  toolkit_id: string
  name: string
  description: string
  progressive_guidance?: string
  icon_name?: string
  execution?: {
    provider: string
  }
  functions: Record<
    string,
    {
      description: string
      progressive_guidance?: string
      parameters: Record<string, unknown>
      output_schema?: Record<string, unknown>
    }
  >
}

export interface SatelliteToolkitDefinition {
  id: string
  name: string
  description: string
  progressive_guidance?: string
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

export interface SatelliteToolCancellation {
  invocationId: string
}

export interface SatelliteToolProgressPayload {
  invocationId: string
  progress: ToolRuntimeProgress
}

export interface SatelliteToolResultPayload {
  invocationId: string
  result: ToolExecutionResult
  artifacts?: SatelliteArtifactBundle
}

export interface SatelliteArtifactBundle {
  root: string
  entries: Array<{
    path: string
    // Omitted for a directory; directories never imply recursive transfer.
    dataBase64?: string
  }>
}

export interface SatelliteErrorPayload {
  code: string
  message: string
}
