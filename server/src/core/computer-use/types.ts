import type {
  CuaDriverLike,
  ToolResult as CuaToolResult
} from '@trycua/cua-driver'

import type {
  ToolProviderExecutionInput,
  ToolProviderModelFile
} from '@/core/tool-provider/types'

export interface ComputerUseDriver extends Pick<
  CuaDriverLike,
  'callTool' | 'isAvailable' | 'listToolsJson' | 'shutdown'
> {
  supportsPostActionCapture?: boolean
  uniffiDestroy(): void
}

export type ComputerUseDriverFactory = () => Promise<ComputerUseDriver>

export enum ComputerUseInteractionMode {
  Background = 'background',
  Visible = 'visible'
}

export enum ComputerUseVisualChangeStatus {
  Changed = 'changed',
  Unchanged = 'unchanged',
  Unavailable = 'unavailable'
}

export type ComputerUseInteractionModeResolver = (
  input: ToolProviderExecutionInput
) => ComputerUseInteractionMode

export type PreferredApplicationsResolver = (
  input: ToolProviderExecutionInput
) => Record<string, string>

export interface ManagedComputerUseRuntime {
  driver: ComputerUseDriver
  sessionAwareActions: Set<string>
  foregroundCapableActions: Set<string>
  initializedSessions: Set<string>
}

export interface ComputerUseImageDimensions {
  width: number
  height: number
}

export interface ComputerUseImageTransform {
  source: ComputerUseImageDimensions
  model: ComputerUseImageDimensions
}

export interface PersistedComputerUseImages {
  artifacts: Array<Record<string, unknown>>
  modelFiles: ToolProviderModelFile[]
  transform: ComputerUseImageTransform | null
  fingerprint: string | null
}

export interface CapturedComputerUseState {
  result: Record<string, unknown>
  artifacts: Array<Record<string, unknown>>
  modelFiles: ToolProviderModelFile[]
  visualChange: ComputerUseVisualChange
}

export interface ComputerUseVisualChange {
  status: ComputerUseVisualChangeStatus
  comparison: 'exact_capture'
}

export interface CompactedComputerUseResult {
  result: Record<string, unknown>
  changed: boolean
}

export interface StructuredComputerUseFailure {
  code?: string
  message: string
}

export interface RemoteComputerUseResponse {
  status?: string
  output?: unknown
  error_code?: string
  error_message?: string
}

export type { CuaToolResult }
