import { randomUUID } from 'node:crypto'

import { formatFilePath } from '@sdk/utils'
import { Tool } from '@sdk/base-tool'
import { reportToolOutput } from '@sdk/tool-reporter'
import {
  parseSkillToolBridgeMessage,
  SKILL_TOOL_REQUEST_PREFIX,
  SKILL_TOOL_REQUEST_TIMEOUT_MS,
  SKILL_TOOL_RESULT_PREFIX,
  type SkillToolExecutionInput,
  type SkillToolExecutionResult,
  type SkillToolResponse
} from '@/core/skill-tool-bridge'

interface PendingToolRequest {
  resolve: (result: SkillToolExecutionResult) => void
  timeout: NodeJS.Timeout
}

export class MissingToolSettingsError extends Error {
  missing: string[]
  settingsPath: string

  constructor(missing: string[], settingsPath: string) {
    super(`Missing tool settings: ${missing.join(', ')}`)
    this.name = 'MissingToolSettingsError'
    this.missing = missing
    this.settingsPath = settingsPath
  }
}

export const isMissingToolSettingsError = (
  error: unknown
): error is MissingToolSettingsError => {
  return error instanceof MissingToolSettingsError
}

export default class ToolManager {
  private static readonly pendingToolRequests = new Map<
    string,
    PendingToolRequest
  >()
  private static stdinBuffer = ''
  private static isListeningForToolResults = false

  static async initTool<TTool extends Tool>(
    ToolClass: new () => TTool
  ): Promise<TTool> {
    const tool = new ToolClass()
    const missing = tool.getMissingSettings()

    if (missing) {
      try {
        await reportToolOutput({
          key: 'bridges.tools.missing_settings',
          data: {
            tool_name: tool.aliasToolName,
            missing: missing.missing.join(', '),
            settings_path: formatFilePath(missing.settingsPath)
          },
          core: {
            should_stop_skill: true
          }
        })
      } catch (error) {
        console.warn(
          `[LEON_TOOL_LOG] Failed to report missing tool settings: ${
            (error as Error).message
          }`
        )
      }
      throw new MissingToolSettingsError(missing.missing, missing.settingsPath)
    }

    return tool
  }

  /** Ask Leon Core to run a profile tool, including Satellite-hosted tools. */
  static async executeTool<
    TOutput extends Record<string, unknown> = Record<string, unknown>
  >(
    input: SkillToolExecutionInput
  ): Promise<SkillToolExecutionResult<TOutput>> {
    this.startToolResultListener()

    const requestId = randomUUID()

    return new Promise<SkillToolExecutionResult<TOutput>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingToolRequests.delete(requestId)
        this.stopToolResultListenerIfIdle()
        reject(new Error('Leon Core tool execution timed out.'))
      }, SKILL_TOOL_REQUEST_TIMEOUT_MS)

      timeout.unref?.()
      this.pendingToolRequests.set(requestId, {
        resolve: resolve as (result: SkillToolExecutionResult) => void,
        timeout
      })
      process.stdout.write(
        `${SKILL_TOOL_REQUEST_PREFIX} ${JSON.stringify({ requestId, input })}\n`
      )
    })
  }

  private static readonly handleToolResultData = (data: Buffer): void => {
    this.stdinBuffer += data.toString()

    let newlineIndex = this.stdinBuffer.indexOf('\n')

    while (newlineIndex >= 0) {
      const line = this.stdinBuffer.slice(0, newlineIndex).trim()
      this.stdinBuffer = this.stdinBuffer.slice(newlineIndex + 1)
      this.handleToolResultLine(line)
      newlineIndex = this.stdinBuffer.indexOf('\n')
    }
  }

  private static handleToolResultLine(line: string): void {
    const response = parseSkillToolBridgeMessage<SkillToolResponse>(
      line,
      SKILL_TOOL_RESULT_PREFIX
    )
    const pending = response
      ? this.pendingToolRequests.get(response.requestId)
      : null

    if (!response || !pending) {
      return
    }

    clearTimeout(pending.timeout)
    this.pendingToolRequests.delete(response.requestId)
    pending.resolve(response.result)
    this.stopToolResultListenerIfIdle()
  }

  private static startToolResultListener(): void {
    if (this.isListeningForToolResults) {
      return
    }

    this.isListeningForToolResults = true
    process.stdin.on('data', this.handleToolResultData)
    process.stdin.resume()
  }

  private static stopToolResultListenerIfIdle(): void {
    if (this.pendingToolRequests.size > 0) {
      return
    }

    process.stdin.off('data', this.handleToolResultData)
    process.stdin.pause()
    this.stdinBuffer = ''
    this.isListeningForToolResults = false
  }
}
