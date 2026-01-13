import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

interface BashResult {
  success: boolean
  stdout: string
  stderr: string
  returncode: number
  command: string
}

interface ExecuteOptions {
  cwd?: string
  timeout?: number
  captureOutput?: boolean
}

export default class BashTool extends Tool {
  private static readonly TOOLKIT = 'operating_system_control'
  private readonly config: ReturnType<typeof ToolkitConfig.load>

  constructor() {
    super()
    // Load configuration from central toolkits directory
    const toolConfigName = this.constructor.name
      .toLowerCase()
      .replace('tool', '')
    this.config = ToolkitConfig.load(BashTool.TOOLKIT, toolConfigName)
  }

  get toolName(): string {
    return this.constructor.name
  }

  get toolkit(): string {
    return BashTool.TOOLKIT
  }

  get description(): string {
    return this.config['description']
  }

  /**
   * Execute a bash command and return the result.
   */
  async executeBashCommand(
    command: string,
    options: ExecuteOptions = {}
  ): Promise<BashResult> {
    const { cwd = process.cwd(), timeout = 30 } = options

    try {
      // Use the base tool's command execution method
      // For bash commands, we'll use 'bash' as the binary and '-c' with the command as args
      const resultOutput = await this.executeCommand({
        binaryName: 'bash',
        args: ['-c', command],
        options: {
          sync: true,
          cwd,
          timeout: timeout * 1_000
        },
        skipBinaryDownload: true // bash is a built-in command, no need to download
      })

      return {
        success: true,
        stdout: resultOutput.trim(),
        stderr: '',
        returncode: 0,
        command
      }
    } catch (error: unknown) {
      const errorMessage = (error as Error).message

      // Parse error to determine if it was a timeout, command failure, or other error
      if (errorMessage.toLowerCase().includes('timed out')) {
        return {
          success: false,
          stdout: '',
          stderr: `Command timed out after ${timeout} seconds`,
          returncode: -1,
          command
        }
      } else if (errorMessage.includes('failed with exit code')) {
        // Extract exit code and error from the base tool's error message
        const exitCodeMatch = errorMessage.match(/exit code (\d+)/)
        const exitCode =
          exitCodeMatch && exitCodeMatch[1]
            ? parseInt(exitCodeMatch[1], 10)
            : -1

        // Extract stderr from the error message if present
        const stderrMatch = errorMessage.match(/exit code \d+: (.+)$/)
        const stderr =
          stderrMatch && stderrMatch[1] ? stderrMatch[1] : errorMessage

        return {
          success: false,
          stdout: '',
          stderr,
          returncode: exitCode,
          command
        }
      } else {
        return {
          success: false,
          stdout: '',
          stderr: errorMessage,
          returncode: -1,
          command
        }
      }
    }
  }

  /**
   * Basic safety check for bash commands.
   * Returns True if command appears safe to execute.
   */
  async isSafeCommand(command: string): Promise<boolean> {
    // List of dangerous command patterns
    const dangerousPatterns = [
      'rm -rf /',
      'rm -rf /*',
      'mkfs',
      'dd if=',
      'format',
      'fdisk',
      '> /dev/',
      'chmod 777 /',
      'chown -R',
      'kill -9 -1',
      'killall -9',
      'fork()',
      'while true; do',
      'curl | sh',
      'wget | sh',
      '| bash',
      '| sh',
      'eval $(curl',
      'eval $(wget'
    ]

    const commandLower = command.toLowerCase()

    // Check for dangerous patterns
    for (const pattern of dangerousPatterns) {
      if (commandLower.includes(pattern)) {
        return false
      }
    }

    return true
  }

  /**
   * Assess the risk level of a command.
   * Returns: 'low', 'medium', 'high', or 'critical'
   */
  async getCommandRiskLevel(command: string): Promise<string> {
    const commandLower = command.toLowerCase()

    // Critical risk commands
    const criticalPatterns = [
      'rm -rf /',
      'rm -rf /*',
      'mkfs',
      'format',
      'fdisk',
      'kill -9 -1'
    ]

    // High risk commands
    const highRiskPatterns = [
      'rm -rf',
      'rm -f',
      'chmod 777',
      'chown -R',
      'dd if=',
      'killall',
      'pkill',
      'sudo su',
      'curl | sh',
      'wget | sh'
    ]

    // Medium risk commands
    const mediumRiskPatterns = [
      'sudo',
      'rm ',
      'mv ',
      'cp ',
      'chmod',
      'chown',
      'install',
      'apt ',
      'yum ',
      'brew ',
      'pip install'
    ]

    let riskLevel = 'low'

    for (const pattern of criticalPatterns) {
      if (commandLower.includes(pattern)) {
        riskLevel = 'critical'
        break
      }
    }

    if (riskLevel === 'low') {
      for (const pattern of highRiskPatterns) {
        if (commandLower.includes(pattern)) {
          riskLevel = 'high'
          break
        }
      }
    }

    if (riskLevel === 'low') {
      for (const pattern of mediumRiskPatterns) {
        if (commandLower.includes(pattern)) {
          riskLevel = 'medium'
          break
        }
      }
    }

    return riskLevel
  }

  /**
   * Get a human-readable description of the command's risk.
   */
  async getRiskDescription(command: string): Promise<string> {
    const riskLevel = await this.getCommandRiskLevel(command)
    const commandLower = command.toLowerCase()

    if (commandLower.includes('rm')) {
      return 'delete files or directories permanently'
    } else if (commandLower.includes('sudo')) {
      return 'make system-level changes with elevated privileges'
    } else if (commandLower.includes('kill')) {
      return 'terminate running processes'
    } else if (
      commandLower.includes('chmod') ||
      commandLower.includes('chown')
    ) {
      return 'change file permissions or ownership'
    } else if (
      ['apt', 'yum', 'brew', 'pip'].some((pkg) => commandLower.includes(pkg))
    ) {
      return 'install or modify system packages'
    } else if (commandLower.includes('curl') || commandLower.includes('wget')) {
      return 'download content from the internet'
    } else {
      const descriptions: Record<string, string> = {
        critical: 'cause severe system damage',
        high: 'cause significant system changes',
        medium: 'modify your system',
        low: 'perform system operations'
      }
      return descriptions[riskLevel] || 'affect your system'
    }
  }
}
