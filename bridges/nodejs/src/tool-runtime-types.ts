import type { Tool } from './sdk/base-tool'
import type { ToolRuntimeLifetime } from '@@/bridges/runtime/contracts/tool-runtime-types'

export { ToolRuntimeLifetime, type ToolWorkerRequest, type ToolWorkerResponse } from '@@/bridges/runtime/contracts/tool-runtime-types'

/**
 * Optional process hooks for tools that own resources beyond a single call.
 * These belong to the Node worker host, not the cross-language Tool API.
 */
export interface ManagedTool extends Tool {
  readonly runtimeLifetime?: ToolRuntimeLifetime
  dispose?: () => Promise<void>
}
