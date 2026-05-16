import fs from 'node:fs'
import path from 'node:path'

import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'
import { isWindows } from '@sdk/utils'

const DEFAULT_SETTINGS: Record<string, unknown> = {}
const REQUIRED_SETTINGS: string[] = []

interface ShellResult {
  success: boolean
  commandSucceeded?: boolean
  error?: string
  stdout: string
  stderr: string
  returncode: number
  command: string
  attempts: ShellAttempt[]
}

interface ShellAttempt {
  attempt: number
  timeoutMs: number
  durationMs: number
  status: 'success' | 'timeout' | 'error'
  error?: string
}

interface ExecuteOptions {
  cwd?: string
  longRunning?: boolean
  captureOutput?: boolean
}

interface ProcessExecutionError extends Error {
  stdout?: Buffer | string
  stderr?: Buffer | string
  status?: number
  code?: number | string | null
}

interface ShellInvocation {
  binaryName: string
  args: string[]
}

const DEFAULT_TIMEOUT_SECONDS = 30
const LONG_RUNNING_TIMEOUT_SECONDS = 86_400
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
const POWERSHELL_ELEVATED_COMMAND_TOKENS = [
  'start-process',
  'runas'
] as const
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
  'while true; do',
  'while ($true)'
]

const POWERSHELL_HIGH_RISK_COMMAND_TOKENS = [
  'invoke-expression',
  'iex',
  'set-executionpolicy',
  'stop-computer',
  'restart-computer'
] as const
const POWERSHELL_DESTRUCTIVE_COMMAND_TOKENS = [
  'remove-item',
  'del',
  'erase',
  'rmdir',
  'rd'
] as const

const TERMINAL_AUTH_COMMANDS = new Set<string>([
  ...ELEVATED_COMMAND_TOKENS,
  ...POWERSHELL_ELEVATED_COMMAND_TOKENS
])
const TERMINAL_AUTH_WRAPPERS = new Set<string>([
  'env',
  'command',
  'builtin',
  'nohup',
  'time'
])

export default class ShellTool extends Tool {
  private static readonly TOOLKIT = 'operating_system_control'
  private readonly config: ReturnType<typeof ToolkitConfig.load>

  constructor() {
    super()
    this.config = ToolkitConfig.load(ShellTool.TOOLKIT, this.toolName)
    const toolSettings = ToolkitConfig.loadToolSettings(
      ShellTool.TOOLKIT,
      this.toolName,
      DEFAULT_SETTINGS
    )
    this.settings = toolSettings
    this.requiredSettings = REQUIRED_SETTINGS
    this.checkRequiredSettings(this.toolName)
  }

  get toolName(): string {
    return 'shell'
  }

  get toolkit(): string {
    return ShellTool.TOOLKIT
  }

  get description(): string {
    return this.config['description']
  }

  async executeCommand(
    command: string,
    options: ExecuteOptions = {}
  ): Promise<ShellResult> {
    const { cwd = process.cwd() } = options
    const timeoutMs = ShellTool.getTimeoutMs(options)
    const shellInvocation = ShellTool.getShellInvocation(command)
    const analyzedCommand = await this.resolveCommandForSafetyAnalysis(command)
    const isSafe = await this.isSafeCommand(analyzedCommand)

    if (!isSafe) {
      const riskLevel = await this.getCommandRiskLevel(analyzedCommand)
      const riskDescription = await this.getRiskDescription(analyzedCommand)

      return {
        success: false,
        error: `Blocked unsafe shell command (${riskLevel} risk): This command may ${riskDescription}.`,
        stdout: '',
        stderr: `Blocked unsafe shell command (${riskLevel} risk): This command may ${riskDescription}.`,
        returncode: -1,
        command,
        attempts: []
      }
    }

    const requiresVisibleTerminal = this.requiresVisibleTerminal(analyzedCommand)
    const attempts: ShellAttempt[] = []
    const attempt = 1
    const attemptStartedAt = Date.now()

    try {
      if (requiresVisibleTerminal) {
        await this.report('bridges.tools.command_requires_terminal_auth')

        await super.executeCommand({
          binaryName: shellInvocation.binaryName,
          args: shellInvocation.args,
          options: {
            openInTerminal: true,
            waitForExit: true,
            cwd,
            timeout: timeoutMs
          },
          skipBinaryDownload: true
        })
        attempts.push({
          attempt,
          timeoutMs,
          durationMs: Date.now() - attemptStartedAt,
          status: 'success'
        })

        return {
          success: true,
          commandSucceeded: true,
          stdout:
            'Command executed in a visible terminal. Review that terminal for command output.',
          stderr: '',
          returncode: 0,
          command,
          attempts
        }
      }

      const resultOutput = await super.executeCommand({
        binaryName: shellInvocation.binaryName,
        args: shellInvocation.args,
        options: {
          sync: false,
          cwd,
          timeout: timeoutMs
        },
        skipBinaryDownload: true
      })
      attempts.push({
        attempt,
        timeoutMs,
        durationMs: Date.now() - attemptStartedAt,
        status: 'success'
      })

      return {
        success: true,
        commandSucceeded: true,
        stdout: resultOutput.trim(),
        stderr: '',
        returncode: 0,
        command,
        attempts
      }
    } catch (error: unknown) {
      const errorMessage = (error as Error).message
      const processError = ShellTool.readProcessError(error)
      const timedOut = ShellTool.isTimeoutErrorMessage(errorMessage)
      const durationMs = Date.now() - attemptStartedAt

      if (timedOut) {
        const timeoutMessage = `Command timed out after ${ShellTool.formatTimeoutMs(timeoutMs)} (1 attempt)`

        return {
          success: false,
          error: timeoutMessage,
          stdout: '',
          stderr: timeoutMessage,
          returncode: -1,
          command,
          attempts: [
            ...attempts,
            {
              attempt,
              timeoutMs,
              durationMs,
              status: 'timeout',
              error: timeoutMessage
            }
          ]
        }
      }

      if (
        errorMessage.includes('failed with exit code') ||
        processError.exitCode !== -1
      ) {
        const exitCodeMatch = errorMessage.match(/exit code (\d+)/)
        const exitCode =
          processError.exitCode !== -1
            ? processError.exitCode
            : exitCodeMatch && exitCodeMatch[1]
              ? parseInt(exitCodeMatch[1], 10)
              : -1
        const stderrMatch = errorMessage.match(/exit code \d+: ([\s\S]*)$/)
        const parsedErrorOutput =
          stderrMatch && stderrMatch[1] ? stderrMatch[1].trim() : errorMessage
        const stderr =
          processError.stderr || (processError.stdout ? '' : parsedErrorOutput)
        const failureOutput = ShellTool.joinOutput([
          processError.stdout,
          stderr
        ]) || errorMessage
        const attemptResult: ShellAttempt = {
          attempt,
          timeoutMs,
          durationMs,
          status: 'error'
        }
        attemptResult.error = failureOutput
        attempts.push(attemptResult)

        return {
          success: false,
          commandSucceeded: false,
          error: requiresVisibleTerminal
            ? `Command failed in the visible terminal with exit code ${exitCode}. Review that terminal for details.`
            : failureOutput,
          stdout: processError.stdout,
          stderr: requiresVisibleTerminal
            ? `Command failed in the visible terminal with exit code ${exitCode}. Review that terminal for details.`
            : stderr,
          returncode: exitCode,
          command,
          attempts
        }
      }

      const failureOutput = ShellTool.joinOutput([
        processError.stdout,
        processError.stderr
      ]) || errorMessage
      attempts.push({
        attempt,
        timeoutMs,
        durationMs,
        status: 'error',
        error: failureOutput
      })

      return {
        success: false,
        error: failureOutput,
        stdout: processError.stdout,
        stderr: processError.stderr || errorMessage,
        returncode: -1,
        command,
        attempts
      }
    }
  }

  private static getShellInvocation(command: string): ShellInvocation {
    if (isWindows()) {
      const trimmedCommand = command.trim()
      if (
        trimmedCommand.toLowerCase().endsWith('.ps1') &&
        !/\s/.test(trimmedCommand)
      ) {
        return {
          binaryName: 'powershell.exe',
          args: [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            trimmedCommand
          ]
        }
      }

      return {
        binaryName: 'powershell.exe',
        args: [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          command
        ]
      }
    }

    return {
      binaryName: 'bash',
      args: ['-c', command]
    }
  }

  private static getTimeoutMs(options: ExecuteOptions): number {
    const timeoutSeconds = options.longRunning
      ? LONG_RUNNING_TIMEOUT_SECONDS
      : DEFAULT_TIMEOUT_SECONDS

    return timeoutSeconds * MILLISECONDS_PER_SECOND
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

  private static readProcessError(error: unknown): {
    stdout: string
    stderr: string
    exitCode: number
  } {
    const processError = error as ProcessExecutionError
    const exitCode =
      typeof processError.status === 'number'
        ? processError.status
        : typeof processError.code === 'number'
          ? processError.code
          : -1

    return {
      stdout: ShellTool.toOutputString(processError.stdout),
      stderr: ShellTool.toOutputString(processError.stderr),
      exitCode
    }
  }

  private static toOutputString(output?: Buffer | string): string {
    if (!output) {
      return ''
    }

    return output.toString().trim()
  }

  private static joinOutput(outputs: string[]): string {
    return outputs
      .map((output) => output.trim())
      .filter((output) => output.length > 0)
      .join('\n')
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
      this.hasCommandToken(tokens, POWERSHELL_HIGH_RISK_COMMAND_TOKENS) ||
      this.hasDangerousPowerShellRemovePattern(tokens) ||
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
      this.hasCommandToken(tokens, CRITICAL_COMMAND_TOKENS) ||
      this.hasDangerousPowerShellRemovePattern(tokens)
    ) {
      riskLevel = 'critical'
    }

    if (riskLevel === 'low') {
      if (
        this.hasCommandToken(tokens, POWERSHELL_HIGH_RISK_COMMAND_TOKENS) ||
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
    } else if (
      this.hasCommandToken(tokens, [
        ...ELEVATED_COMMAND_TOKENS,
        ...POWERSHELL_ELEVATED_COMMAND_TOKENS
      ])
    ) {
      return 'make system-level changes with elevated privileges'
    } else if (
      this.hasCommandToken(tokens, ['kill', 'stop-process'])
    ) {
      return 'terminate running processes'
    } else if (this.hasDangerousPowerShellRemovePattern(tokens)) {
      return 'delete files or directories recursively'
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
      commandLower.includes('| bash') ||
      commandLower.includes('| sh') ||
      commandLower.includes('| iex') ||
      commandLower.includes('| invoke-expression')

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

  private hasDangerousPowerShellRemovePattern(tokens: string[]): boolean {
    if (!this.hasCommandToken(tokens, POWERSHELL_DESTRUCTIVE_COMMAND_TOKENS)) {
      return false
    }

    return tokens.some((token) =>
      ['-recurse', '-r', '/s'].includes(token)
    )
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

    if (strippedToken.includes('\\')) {
      return strippedToken.split('\\').pop() || strippedToken
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
