import path from 'node:path'

import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

const DEFAULT_SETTINGS: Record<string, unknown> = {}
const REQUIRED_SETTINGS: string[] = []
const DEFAULT_TIMEOUT_SECONDS = 1_800
const DEFAULT_THINKING = 'medium'
const SHELL_ENV_PREFIX = 'PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0'

interface PiCodingTaskResult {
  success: boolean
  output: string
  cwd: string
}

export default class PiTool extends Tool {
  private static readonly TOOLKIT = 'coding_development'
  private readonly config: ReturnType<typeof ToolkitConfig.load>

  constructor() {
    super()
    this.config = ToolkitConfig.load(PiTool.TOOLKIT, this.toolName)
    const toolSettings = ToolkitConfig.loadToolSettings(
      PiTool.TOOLKIT,
      this.toolName,
      DEFAULT_SETTINGS
    )
    this.settings = toolSettings
    this.requiredSettings = REQUIRED_SETTINGS
    this.checkRequiredSettings(this.toolName)
  }

  get toolName(): string {
    return 'pi'
  }

  get toolkit(): string {
    return PiTool.TOOLKIT
  }

  get description(): string {
    return this.config['description']
  }

  /**
   * Run a non-interactive Pi coding-agent task.
   */
  async runCodingTask(
    prompt: string,
    cwd = process.cwd(),
    provider?: string,
    model?: string,
    apiKey?: string,
    thinking = DEFAULT_THINKING,
    tools?: string,
    timeout = DEFAULT_TIMEOUT_SECONDS
  ): Promise<PiCodingTaskResult> {
    const piPath = await this.getBinaryPath('pi')
    const resolvedCwd = path.resolve(cwd)
    const args = ['-p', '--no-session', '--thinking', thinking]

    if (provider) {
      args.push('--provider', provider)
    }

    if (model) {
      args.push('--model', model)
    }

    if (apiKey) {
      args.push('--api-key', apiKey)
    }

    if (tools) {
      args.push('--tools', tools)
    }

    args.push(prompt)

    const output = await this.executeCommand({
      binaryName: 'bash',
      args: [
        '-c',
        `${SHELL_ENV_PREFIX} ${PiTool.escapeShellArg(piPath)} ${args
          .map((arg) => PiTool.escapeShellArg(arg))
          .join(' ')}`
      ],
      options: {
        sync: true,
        cwd: resolvedCwd,
        timeout: timeout * 1_000
      },
      skipBinaryDownload: true
    })

    return {
      success: true,
      output: output.trim(),
      cwd: resolvedCwd
    }
  }

  private static escapeShellArg(value: string): string {
    return `'${value.replace(/'/g, '\'\\\'\'')}'`
  }
}
