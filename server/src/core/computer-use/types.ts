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
  setAgentCursorEnabled?: CuaDriverLike['setAgentCursorEnabled']
  uniffiDestroy(): void
}

export type ComputerUseDriverFactory = (
  input: ToolProviderExecutionInput
) => Promise<ComputerUseDriver>

export enum ComputerUseInteractionMode {
  Background = 'background',
  Visible = 'visible'
}

export enum ComputerUseSetOfMarkMode {
  Auto = 'auto',
  Always = 'always',
  Never = 'never'
}

export type ComputerUseInteractionModeResolver = (
  input: ToolProviderExecutionInput
) => ComputerUseInteractionMode

export type ComputerUseActivityOverlayResolver = (
  input: ToolProviderExecutionInput
) => boolean

export type ComputerUseSetOfMarkModeResolver = (
  input: ToolProviderExecutionInput
) => ComputerUseSetOfMarkMode

export type PreferredApplicationsResolver = (
  input: ToolProviderExecutionInput
) => Record<string, string>

export interface ManagedComputerUseRuntime {
  driver: ComputerUseDriver
  browserInspectionAllowed: boolean
  sessionAwareActions: Set<string>
  foregroundCapableActions: Set<string>
  zoomCapableActions: Set<string>
  initializedSessions: Set<string>
  activityOverlaySessions: Set<string>
  /** Only the conversation that started recording receives automatic evidence captures. */
  recordingSessionId?: string | null
}

export interface ComputerUseImageDimensions {
  width: number
  height: number
}

export interface ComputerUseImageTransform {
  source: ComputerUseImageDimensions
  model: ComputerUseImageDimensions
  /** Cua owns padded crop offsets; supported input must use its zoom mapping. */
  fromZoom?: boolean
}

export interface PersistedComputerUseImages {
  artifacts: Array<Record<string, unknown>>
  modelFiles: ToolProviderModelFile[]
  transform: ComputerUseImageTransform | null
  setOfMark: ComputerUseSetOfMarkAnnotation[]
  visualStateId: string | null
}

export interface ComputerUseSetOfMarkAnnotation {
  key: string
  mark: number
}

export interface CapturedComputerUseState {
  result: Record<string, unknown>
  artifacts: Array<Record<string, unknown>>
  modelFiles: ToolProviderModelFile[]
  visualStateId: string | null
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
