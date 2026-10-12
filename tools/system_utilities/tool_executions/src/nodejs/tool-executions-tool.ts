import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'
import type { ToolModelFile } from '@sdk/tool-runtime-types'

interface ReadOptions {
  jq?: string
  offsetChars?: number
  maxChars?: number
}

/**
 * Ordinary tool access to host-owned executions and retained JSON results.
 */
export default class ToolExecutionsTool extends Tool {
  private readonly config = ToolkitConfig.load(this.toolkit, this.toolName)

  get toolName(): string {
    return 'tool_executions'
  }

  get toolkit(): string {
    return 'system_utilities'
  }

  get description(): string {
    return this.config.description
  }

  /**
   * Wait without changing the execution's deadline or starting a second call.
   */
  public async wait(executionId: string, waitMs = 10_000, options: ReadOptions = {}): Promise<Record<string, unknown>> {
    return this.request('wait', executionId, { waitMs, options })
  }

  /**
   * Filter, count, group or page the retained output without filesystem rescans.
   */
  public async read(executionId: string, options: ReadOptions = {}): Promise<Record<string, unknown>> {
    return this.request('read', executionId, { options })
  }

  /**
   * Request cancellation and observe cleanup of the original execution.
   */
  public async cancel(executionId: string): Promise<Record<string, unknown>> {
    return this.request('cancel', executionId, {})
  }

  private async request(action: string, executionId: string, options: Record<string, unknown>): Promise<Record<string, unknown>> {
    const sessionId = this.executionContext?.conversationSessionId

    if (!sessionId) {
      throw new Error('Tool executions require an active conversation.')
    }

    const result = await this.requestLeon<Record<string, unknown>>(
      `/tool-executions/${action}`,
      { executionId, sessionId, ...options }
    )
    if (Array.isArray(result['modelFiles'])) {
      this.attachModelFiles(result['modelFiles'] as ToolModelFile[])
      delete result['modelFiles']
    }

    return result
  }
}
