import type {
  CuaDriverLike,
  ToolResult as CuaToolResult
} from '@trycua/cua-driver'

import type {
  ToolExecutionContext,
  ToolModelFile
} from '@sdk/tool-runtime-types'

/**
 * Supplies live owner settings from the tool instance to retained native sessions.
 */
export interface CuaExecutionContext extends ToolExecutionContext {
  getSettings?: () => Record<string, unknown>
}

export interface ComputerUseDriver extends Pick<
  CuaDriverLike,
  'callTool' | 'isAvailable' | 'listToolsJson' | 'shutdown'
> {
  supportsPostActionCapture?: boolean
  setAgentCursorEnabled?: CuaDriverLike['setAgentCursorEnabled']
  uniffiDestroy(): void
}

export type ComputerUseDriverFactory = (
  input: CuaExecutionContext
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
  input: CuaExecutionContext
) => ComputerUseInteractionMode

export type ComputerUseActivityOverlayResolver = (
  input: CuaExecutionContext
) => boolean

export type ComputerUseSetOfMarkModeResolver = (
  input: CuaExecutionContext
) => ComputerUseSetOfMarkMode

export type PreferredApplicationsResolver = (
  input: CuaExecutionContext
) => Record<string, string>

export interface ManagedComputerUseRuntime {
  driver: ComputerUseDriver
  browserInspectionAllowed: boolean
  sessionAwareActions: Set<string>
  foregroundCapableActions: Set<string>
  zoomCapableActions: Set<string>
  initializedSessions: Set<string>
  activityOverlaySessions: Set<string>
  /**
   * Only the conversation that started recording receives automatic evidence captures.
   */
  recordingSessionId?: string | null
}

export interface ComputerUseImageDimensions {
  width: number
  height: number
}

export interface ComputerUseImageTransform {
  source: ComputerUseImageDimensions
  model: ComputerUseImageDimensions
  /**
   * Cua owns padded crop offsets; supported input must use its zoom mapping.
   */
  fromZoom?: boolean
}

export interface PersistedComputerUseImages {
  artifacts: Array<Record<string, unknown>>
  modelFiles: ToolModelFile[]
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
  modelFiles: ToolModelFile[]
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
