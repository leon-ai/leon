import fs from 'node:fs'
import path from 'node:path'

import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

const DEFAULT_SETTINGS: Record<string, unknown> = {}
const REQUIRED_SETTINGS: string[] = []

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
  timeoutUnit?: 'seconds' | 'milliseconds'
  timeoutRetries?: number
  captureOutput?: boolean
}

const DEFAULT_TIMEOUT_SECONDS = 30
const TIMEOUT_MILLISECONDS_INPUT_THRESHOLD = 10_000
const DEFAULT_TIMEOUT_RETRIES = 2
const MAX_TIMEOUT_RETRIES = 5
const TIMEOUT_RETRY_MULTIPLIER = 2
const MILLISECONDS_PER_SECOND = 1_000

const CRITICAL_COMMAND_SEQUENCES = [
  ['rm', '-rf', '/'],
  ['rm', '-rf', '/*'],
  ['kill', '-9', '-1']
] as const

const CRITICAL_COMMAND_TOKENS = ['mkfs', 'format', 'fdisk'] as const
const HIGH_RISK_DD_TOKENS = ['dd'] as const
const HIGH_RISK_EVAL_DOWNLOAD_TOKENS = ['curl', 'wget'] as const
const ELEVATED_COMMAND_TOKENS = ['sudo', 'doas', 'pkexec', 'su'] as const
const PERMISSION_COMMAND_TOKENS = ['chmod', 'chown'] as const
const PACKAGE_MANAGER_COMMAND_TOKENS = [
  'apt',
  'apt-get',
  'yum',
  'brew',
  'pip',
  'pip3'
] as const

const MEDIUM_RISK_COMMAND_PATTERNS: string[] = []

const UNSAFE_COMMAND_PATTERNS = [
  'fork()',
  'while true; do'
]

const TERMINAL_AUTH_COMMANDS = new Set<string>(ELEVATED_COMMAND_TOKENS)
const TERMINAL_AUTH_WRAPPERS = new Set<string>([
  'env',
  'command',
  'builtin',
  'nohup',
  'time'
])

export default class BashTool extends Tool {
  private static readonly TOOLKIT = 'operating_system_control'
  private readonly config: ReturnType<typeof ToolkitConfig.load>

  constructor() {
    super()
    this.config = ToolkitConfig.load(BashTool.TOOLKIT, this.toolName)
    const toolSettings = ToolkitConfig.loadToolSettings(
      BashTool.TOOLKIT,
      this.toolName,
      DEFAULT_SETTINGS
    )
    this.settings = toolSettings
    this.requiredSettings = REQUIRED_SETTINGS
    this.checkRequiredSettings(this.toolName)
  }

  get toolName(): string {
    return 'bash'
  }

  get toolkit(): string {
    return BashTool.TOOLKIT
  }

  get description(): string {
    return this.config['description']
  }

  async executeBashCommand(
    command: string,
    options: ExecuteOptions = {}
  ): Promise<BashResult> {
    const { cwd = process.cwd() } = options
    const initialTimeoutMs = BashTool.normalizeTimeoutMs(
      options.timeout,
      options.timeoutUnit
    )
    const timeoutRetries = BashTool.normalizeTimeoutRetries(
      options.timeoutRetries
    )
    const analyzedCommand = await this.resolveCommandForSafetyAnalysis(command)
    const isSafe = await this.isSafeCommand(analyzedCommand)

    if (!isSafe) {
      const riskLevel = await this.getCommandRiskLevel(analyzedCommand)
      const riskDescription = await this.getRiskDescription(analyzedCommand)

      return {
        success: false,
        stdout: '',
        stderr: `Blocked unsafe bash command (${riskLevel} risk): This command may ${riskDescription}.`,
        returncode: -1,
        command
      }
    }

    const requiresVisibleTerminal = this.requiresVisibleTerminal(analyzedCommand)
    const effectiveTimeoutRetries = requiresVisibleTerminal ? 0 : timeoutRetries
    let timeoutMs = initialTimeoutMs

    for (let attempt = 0; attempt <= effectiveTimeoutRetries; attempt += 1) {
      try {
        if (requiresVisibleTerminal) {
          await this.report('bridges.tools.command_requires_terminal_auth')

          await this.executeCommand({
            binaryName: 'bash',
            args: ['-c', command],
            options: {
              openInTerminal: true,
              waitForExit: true,
              cwd,
              timeout: timeoutMs
            },
            skipBinaryDownload: true
          })

          return {
            success: true,
            stdout:
              'Command executed in a visible terminal. Review that terminal for command output.',
            stderr: '',
            returncode: 0,
            command
          }
        }

        const resultOutput = await this.executeCommand({
          binaryName: 'bash',
          args: ['-c', command],
          options: {
            sync: true,
            cwd,
            timeout: timeoutMs
          },
          skipBinaryDownload: true
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
        const timedOut = BashTool.isTimeoutErrorMessage(errorMessage)

        if (timedOut && attempt < effectiveTimeoutRetries) {
          timeoutMs *= TIMEOUT_RETRY_MULTIPLIER
          continue
        }

        if (timedOut) {
          return {
            success: false,
            stdout: '',
            stderr: `Command timed out after ${BashTool.formatTimeoutMs(timeoutMs)} (${attempt + 1} attempt${attempt === 0 ? '' : 's'})`,
            returncode: -1,
            command
          }
        }

        if (errorMessage.includes('failed with exit code')) {
          const exitCodeMatch = errorMessage.match(/exit code (\d+)/)
          const exitCode =
            exitCodeMatch && exitCodeMatch[1]
              ? parseInt(exitCodeMatch[1], 10)
              : -1
          const stderrMatch = errorMessage.match(/exit code \d+: (.+)$/)
          const stderr =
            stderrMatch && stderrMatch[1] ? stderrMatch[1] : errorMessage

          return {
            success: false,
            stdout: '',
            stderr: requiresVisibleTerminal
              ? `Command failed in the visible terminal with exit code ${exitCode}. Review that terminal for details.`
              : stderr,
            returncode: exitCode,
            command
          }
        }

        return {
          success: false,
          stdout: '',
          stderr: errorMessage,
          returncode: -1,
          command
        }
      }
    }

    return {
      success: false,
      stdout: '',
      stderr: 'Command failed without an execution result.',
      returncode: -1,
      command
    }
  }

  /**
   * Normalizes timeout input to milliseconds while keeping compatibility with
   * older calls that used seconds and generated calls that often use ms.
   */
  private static normalizeTimeoutMs(
    timeout?: number,
    timeoutUnit?: ExecuteOptions['timeoutUnit']
  ): number {
    const fallbackTimeoutMs = DEFAULT_TIMEOUT_SECONDS * MILLISECONDS_PER_SECOND

    if (!Number.isFinite(timeout) || timeout === undefined || timeout <= 0) {
      return fallbackTimeoutMs
    }

    if (timeoutUnit === 'milliseconds') {
      return Math.round(timeout)
    }

    if (timeoutUnit === 'seconds') {
      return Math.round(timeout * MILLISECONDS_PER_SECOND)
    }

    if (timeout >= TIMEOUT_MILLISECONDS_INPUT_THRESHOLD) {
      return Math.round(timeout)
    }

    return Math.round(timeout * MILLISECONDS_PER_SECOND)
  }

  /**
   * Returns a bounded retry count for timeout-only retries.
   */
  private static normalizeTimeoutRetries(timeoutRetries?: number): number {
    if (!Number.isFinite(timeoutRetries) || timeoutRetries === undefined) {
      return DEFAULT_TIMEOUT_RETRIES
    }

    return Math.min(
      Math.max(Math.floor(timeoutRetries), 0),
      MAX_TIMEOUT_RETRIES
    )
  }

  private static formatTimeoutMs(timeoutMs: number): string {
    const seconds = timeoutMs / MILLISECONDS_PER_SECOND

    if (Number.isInteger(seconds)) {
      return `${seconds} seconds`
    }

    return `${timeoutMs}ms`
  }

  private static isTimeoutErrorMessage(errorMessage: string): boolean {
    const normalizedErrorMessage = errorMessage.toLowerCase()

    return (
      normalizedErrorMessage.includes('timed out') ||
      normalizedErrorMessage.includes('timeout') ||
      normalizedErrorMessage.includes('etimedout')
    )
  }

  async isSafeCommand(command: string): Promise<boolean> {
    const commandLower = command.toLowerCase()
    const tokens = this.tokenizeCommand(commandLower)

    for (const pattern of UNSAFE_COMMAND_PATTERNS) {
      if (commandLower.includes(pattern)) {
        return false
      }
    }

    if (
      this.hasAnyTokenSequence(tokens, CRITICAL_COMMAND_SEQUENCES) ||
      this.hasCommandToken(tokens, CRITICAL_COMMAND_TOKENS) ||
      this.hasDangerousDdPattern(tokens) ||
      this.hasEvalDownloadPattern(tokens)
    ) {
      return false
    }

    if (this.isDownloadPipedToShell(commandLower)) {
      return false
    }

    return true
  }

  async getCommandRiskLevel(command: string): Promise<string> {
    const commandLower = command.toLowerCase()
    const tokens = this.tokenizeCommand(commandLower)

    let riskLevel = 'low'

    if (
      this.hasAnyTokenSequence(tokens, CRITICAL_COMMAND_SEQUENCES) ||
      this.hasCommandToken(tokens, CRITICAL_COMMAND_TOKENS)
    ) {
      riskLevel = 'critical'
    }

    if (riskLevel === 'low') {
      if (
        this.hasDangerousDdPattern(tokens) ||
        this.hasEvalDownloadPattern(tokens)
      ) {
        riskLevel = 'high'
      }
    }

    if (riskLevel === 'low' && this.isDownloadPipedToShell(commandLower)) {
      riskLevel = 'high'
    }

    if (riskLevel === 'low') {
      for (const pattern of MEDIUM_RISK_COMMAND_PATTERNS) {
        if (commandLower.includes(pattern)) {
          riskLevel = 'medium'
          break
        }
      }
    }

    return riskLevel
  }

  async getRiskDescription(command: string): Promise<string> {
    const riskLevel = await this.getCommandRiskLevel(command)
    const commandLower = command.toLowerCase()
    const tokens = this.tokenizeCommand(commandLower)

    if (this.hasCommandToken(tokens, ['rm'])) {
      return 'delete files or directories permanently'
    } else if (this.hasCommandToken(tokens, ELEVATED_COMMAND_TOKENS)) {
      return 'make system-level changes with elevated privileges'
    } else if (this.hasCommandToken(tokens, ['kill'])) {
      return 'terminate running processes'
    } else if (this.hasCommandToken(tokens, PERMISSION_COMMAND_TOKENS)) {
      return 'change file permissions or ownership'
    } else if (
      this.hasCommandToken(tokens, PACKAGE_MANAGER_COMMAND_TOKENS)
    ) {
      return 'install or modify system packages'
    } else if (this.isDownloadPipedToShell(commandLower)) {
      return 'download remote content and execute it as a shell script'
    } else if (this.hasCommandToken(tokens, HIGH_RISK_EVAL_DOWNLOAD_TOKENS)) {
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

  private async resolveCommandForSafetyAnalysis(command: string): Promise<string> {
    const trimmedCommand = command.trim()
    if (!trimmedCommand || /\s/.test(trimmedCommand)) {
      return command
    }

    const resolvedPath = path.resolve(trimmedCommand)

    try {
      const stats = await fs.promises.stat(resolvedPath)
      if (!stats.isFile()) {
        return command
      }

      const fileContent = await fs.promises.readFile(resolvedPath, 'utf8')
      if (!fileContent.trim()) {
        return command
      }

      return fileContent
    } catch {
      return command
    }
  }

  private isDownloadPipedToShell(commandLower: string): boolean {
    const downloadsRemoteContent =
      this.hasCommandToken(this.tokenizeCommand(commandLower), ['curl', 'wget'])
    const pipesToShell =
      commandLower.includes('| bash') || commandLower.includes('| sh')

    return downloadsRemoteContent && pipesToShell
  }

  private tokenizeCommand(command: string): string[] {
    const tokens: string[] = []
    let currentToken = ''
    let quote: '\'' | '"' | null = null
    let escaped = false

    const flushToken = (): void => {
      if (!currentToken) {
        return
      }

      tokens.push(currentToken)
      currentToken = ''
    }

    for (const char of command) {
      if (quote) {
        if (escaped) {
          currentToken += char
          escaped = false
          continue
        }

        if (char === '\\' && quote === '"') {
          escaped = true
          continue
        }

        if (char === quote) {
          quote = null
          continue
        }

        currentToken += char
        continue
      }

      if (char === '\'' || char === '"') {
        quote = char
        continue
      }

      if (
        char === '\n' ||
        char === ';' ||
        char === '|' ||
        char === '&' ||
        char === ' ' ||
        char === '\t' ||
        char === '\r' ||
        char === '>' ||
        char === '<'
      ) {
        flushToken()
        continue
      }

      currentToken += char
    }

    flushToken()
    return tokens
  }

  private hasTokenSequence(tokens: string[], sequence: string[]): boolean {
    if (sequence.length === 0 || tokens.length < sequence.length) {
      return false
    }

    for (let index = 0; index <= tokens.length - sequence.length; index += 1) {
      const matches = sequence.every(
        (token, offset) => tokens[index + offset] === token
      )
      if (matches) {
        return true
      }
    }

    return false
  }

  private hasCommandToken(tokens: string[], commands: readonly string[]): boolean {
    return tokens.some((token) => {
      const normalizedToken = this.normalizeCommandToken(token)
      return commands.some(
        (command) =>
          normalizedToken === command || normalizedToken.startsWith(`${command}.`)
      )
    })
  }

  private hasDangerousDdPattern(tokens: string[]): boolean {
    if (!this.hasCommandToken(tokens, HIGH_RISK_DD_TOKENS)) {
      return false
    }

    return tokens.some((token) => token.startsWith('if='))
  }

  private hasEvalDownloadPattern(tokens: string[]): boolean {
    for (let index = 0; index < tokens.length - 1; index += 1) {
      if (tokens[index] !== 'eval') {
        continue
      }

      const nextToken = tokens[index + 1] || ''
      if (
        HIGH_RISK_EVAL_DOWNLOAD_TOKENS.some((token) =>
          nextToken.startsWith(`$(${token}`)
        )
      ) {
        return true
      }
    }

    return false
  }

  private normalizeCommandToken(token: string): string {
    const strippedToken = token.replace(/^[([{]+|[)\]}]+$/g, '')
    if (strippedToken.includes('/')) {
      return strippedToken.split('/').pop() || strippedToken
    }

    return strippedToken
  }

  private hasAnyTokenSequence(
    tokens: string[],
    sequences: readonly (readonly string[])[]
  ): boolean {
    return sequences.some((sequence) =>
      this.hasTokenSequence(tokens, [...sequence])
    )
  }

  private requiresVisibleTerminal(command: string): boolean {
    let currentToken = ''
    let quote: '\'' | '"' | null = null
    let atCommandStart = true
    let escaped = false

    const flushToken = (): boolean => {
      if (!currentToken) {
        return false
      }

      const token = currentToken
      currentToken = ''

      if (!atCommandStart) {
        return false
      }

      if (this.isShellAssignment(token) || TERMINAL_AUTH_WRAPPERS.has(token)) {
        return false
      }

      atCommandStart = false
      return TERMINAL_AUTH_COMMANDS.has(token)
    }

    for (const char of command) {
      if (quote) {
        if (escaped) {
          escaped = false
          continue
        }

        if (char === '\\' && quote === '"') {
          escaped = true
          continue
        }

        if (char === quote) {
          quote = null
        }
        continue
      }

      if (char === '\'' || char === '"') {
        quote = char
        continue
      }

      if (char === '\n' || char === ';' || char === '|' || char === '&') {
        if (flushToken()) {
          return true
        }
        atCommandStart = true
        continue
      }

      if (char === ' ' || char === '\t' || char === '\r') {
        if (flushToken()) {
          return true
        }
        continue
      }

      currentToken += char
    }

    return flushToken()
  }

  private isShellAssignment(token: string): boolean {
    const separatorIndex = token.indexOf('=')
    if (separatorIndex <= 0) {
      return false
    }

    return !token.slice(0, separatorIndex).includes('/')
  }
}
