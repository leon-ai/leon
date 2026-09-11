import type { Tool } from './sdk/base-tool'
import type { ToolExecutionContext, ToolRuntimeResult } from './sdk/tool-runtime-types'

/**
 * Internal worker retention policy; ordinary SDK tools run once by default.
 */
export enum ToolRuntimeLifetime {
  Call = 'call',
  Persistent = 'persistent'
}

/**
 * Optional process hooks for tools that own resources beyond a single call.
 * These belong to the Node worker host, not the cross-language Tool API.
 */
export interface ManagedTool extends Tool {
  readonly runtimeLifetime?: ToolRuntimeLifetime
  dispose?: () => Promise<void>
}

export type ToolWorkerRequest =
  | { type: 'execute', context: Omit<ToolExecutionContext, 'onProgress' | 'signal'>, args: unknown[] }
  | { type: 'shutdown' }

export interface ToolWorkerResponse {
  type: 'result'
  lifetime: ToolRuntimeLifetime
  result: ToolRuntimeResult
}
