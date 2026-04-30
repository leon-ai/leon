import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import jq from 'node-jq'
import type { Json as NodeJQJson } from 'node-jq/lib/options'

import { LogHelper } from '@/helpers/log-helper'
import {
  CODEBASE_PATH,
  NODE_RUNTIME_BIN_PATH,
  NODEJS_BRIDGE_TOOL_RUNTIME_SRC_PATH,
  NODEJS_BRIDGE_ROOT_PATH,
  TSX_CLI_PATH
} from '@/constants'
import { TOOLKIT_REGISTRY, TOOL_CALL_LOGGER } from '@/core'

const execFileAsync = promisify(execFile)
const ABSOLUTE_OR_HOME_PATH_PATTERN = /^(~($|[\\/])|\/|[A-Za-z]:[\\/])/
const EXPLICIT_RELATIVE_PATH_PATTERN = /^\.\.?([\\/]|$)/

interface ToolExecutionInput {
  toolId: string
  toolkitId?: string
  functionName?: string
  toolInput?: string
  parsedInput?: Record<string, unknown>
}

interface ToolExecutionResult {
  status: 'success' | 'error' | 'not_available' | 'invalid_input'
  message: string
  data: {
    tool_id: string
    toolkit_id: string | null
    function_name: string | null
    input: string | null
    parsed_input: Record<string, unknown> | null
    output: Record<string, unknown>
  }
  toolLabel?: string | undefined
}

export default class ToolExecutor {
  private static instance: ToolExecutor

  private logToolRuntimeMessages(
    toolkitId: string,
    toolId: string,
    runtimeStderr: string
  ): void {
    if (
      toolkitId !== 'structured_knowledge' ||
      toolId !== 'memory' ||
      !runtimeStderr
    ) {
      return
    }

    const toolLogLines = runtimeStderr
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('[LEON_TOOL_LOG]'))
      .map((line) => line.replace('[LEON_TOOL_LOG]', '').trim())
      .filter(Boolean)

    for (const line of toolLogLines) {
      LogHelper.title('Memory Tool')
      LogHelper.debug(line)
    }
  }

  constructor() {
    if (!ToolExecutor.instance) {
      LogHelper.title('Tool Executor')
      LogHelper.success('New instance')

      ToolExecutor.instance = this
    }
  }

  public async executeTool(
    input: ToolExecutionInput
  ): Promise<ToolExecutionResult> {
    const { toolId, toolkitId, functionName } = input
    const resolvedTool = TOOLKIT_REGISTRY.resolveToolById(toolId, toolkitId)

    if (!resolvedTool) {
      return this.buildResult({
        status: 'invalid_input',
        message: toolkitId
          ? 'Unknown tool_id for selected toolkit.'
          : 'Unknown or ambiguous tool_id. Select a toolkit first.',
        input: input.toolInput ?? null,
        resolvedTool: null
      })
    }

    if (!functionName) {
      return this.buildResult({
        status: 'invalid_input',
        message: 'Missing function_name for selected tool.',
        input: input.toolInput ?? null,
        resolvedTool,
        functionName: null
      })
    }

    const functions = TOOLKIT_REGISTRY.getToolFunctions(
      resolvedTool.toolkitId,
      resolvedTool.toolId
    )
    if (!functions || !functions[functionName]) {
      return this.buildResult({
        status: 'invalid_input',
        message: `Unknown function_name "${functionName}" for selected tool.`,
        input: input.toolInput ?? null,
        resolvedTool,
        functionName
      })
    }
    const functionConfig = functions[functionName]

    const parsedInput =
      input.parsedInput || this.parseToolInput(input.toolInput)
    if (!parsedInput) {
      return this.buildResult({
        status: 'invalid_input',
        message: 'tool_input must be valid JSON.',
        input: input.toolInput ?? null,
        resolvedTool,
        functionName,
        parsedInput: null
      })
    }

    const normalizedParsedInput = this.normalizeFilesystemValues(parsedInput) as Record<
      string,
      unknown
    >
    const responseJQ = this.getResponseJQ(functionConfig)

    let argsArray: unknown[]
    try {
      argsArray = this.mapArgs(normalizedParsedInput, functionConfig.parameters)
    } catch (error) {
      return this.buildResult({
        status: 'invalid_input',
        message: (error as Error).message,
        input: input.toolInput ?? null,
        resolvedTool,
        functionName,
        parsedInput: normalizedParsedInput,
        output: {}
      })
    }
    const runtimeResult = await this.runToolRuntime({
      toolkitId: resolvedTool.toolkitId,
      toolId: resolvedTool.toolId,
      functionName,
      args: argsArray
    })
    let runtimeOutput = this.normalizeFilesystemValues(
      runtimeResult.output
    ) as Record<string, unknown>
    const toolReportedFailure = runtimeResult.success
      ? this.getToolReportedFailure(runtimeOutput)
      : null

    if (runtimeResult.success && responseJQ && !toolReportedFailure) {
      try {
        runtimeOutput = await this.applyResponseJQ(runtimeResult.output, responseJQ)
      } catch (error) {
        return this.buildResult({
          status: 'invalid_input',
          message: `response_jq failed: ${(error as Error).message}`,
          input: input.toolInput ?? null,
          resolvedTool,
          functionName,
          parsedInput: normalizedParsedInput,
          output: runtimeResult.output
        })
      }
    }

    TOOL_CALL_LOGGER.recordToolCall({
      toolkitId: resolvedTool.toolkitId,
      toolId: resolvedTool.toolId,
      functionName,
      params: normalizedParsedInput
    })

    return this.buildResult({
      status:
        runtimeResult.success && !toolReportedFailure ? 'success' : 'error',
      message: toolReportedFailure?.message || runtimeResult.message,
      input: input.toolInput ?? null,
      resolvedTool,
      functionName,
      parsedInput: normalizedParsedInput,
      output: runtimeOutput
    })
  }

  private async buildResult(params: {
    status: ToolExecutionResult['status']
    message: string
    input: string | null
    resolvedTool: { toolkitId: string, toolId: string } | null
    functionName?: string | null
    parsedInput?: Record<string, unknown> | null
    output?: Record<string, unknown>
  }): Promise<ToolExecutionResult> {
    const result: ToolExecutionResult = {
      status: params.status,
      message: params.message,
      data: {
        tool_id: params.resolvedTool?.toolId || '',
        toolkit_id: params.resolvedTool?.toolkitId || null,
        function_name: params.functionName ?? null,
        input: params.input,
        parsed_input: params.parsedInput ?? null,
        output: params.output ?? {}
      }
    }

    if (params.resolvedTool) {
      result.toolLabel = `${params.resolvedTool.toolkitId}.${params.resolvedTool.toolId}`
    }

    await TOOL_CALL_LOGGER.recordToolOutput({
      toolkitId: result.data.toolkit_id,
      toolId: result.data.tool_id || params.resolvedTool?.toolId || 'unknown',
      functionName: result.data.function_name,
      status: result.status,
      message: result.message,
      rawInput: result.data.input,
      parsedInput: result.data.parsed_input,
      output: result.data.output
    })

    return result
  }

  private parseToolInput(toolInput?: string): Record<string, unknown> | null {
    if (!toolInput) {
      return null
    }

    try {
      const parsed = JSON.parse(toolInput)
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>
      }
    } catch {
      return null
    }

    return null
  }

  private getResponseJQ(functionConfig: {
      hooks?: {
        post_execution?: {
          response_jq?: string
        }
      }
    }
  ): string | null {
    const defaultResponseJQ =
      typeof functionConfig.hooks?.post_execution?.response_jq === 'string'
        ? functionConfig.hooks.post_execution.response_jq.trim()
        : ''

    return defaultResponseJQ || null
  }

  private getToolReportedFailure(output: Record<string, unknown>): {
    message: string
  } | null {
    const outputSuccess = output['success']
    const outputError =
      typeof output['error'] === 'string' ? output['error'].trim() : ''

    if (outputSuccess === false) {
      return {
        message: outputError || 'Tool reported a failure.'
      }
    }

    const result = output['result']
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      return null
    }

    const nestedResult = result as Record<string, unknown>

    const nestedSuccess = nestedResult['success']
    const nestedError =
      typeof nestedResult['error'] === 'string'
        ? nestedResult['error'].trim()
        : ''

    if (nestedSuccess === false) {
      return {
        message: nestedError || outputError || 'Tool reported a failure.'
      }
    }

    return null
  }

  private normalizeFilesystemValues(value: unknown): unknown {
    if (typeof value === 'string') {
      return this.normalizePossibleFilesystemPath(value)
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeFilesystemValues(item))
    }

    if (value && typeof value === 'object') {
      const objectValue = value as Record<string, unknown>
      const normalizedEntries = Object.entries(objectValue).map(([key, nestedValue]) => [
        key,
        this.normalizeFilesystemValues(nestedValue)
      ])

      return Object.fromEntries(normalizedEntries)
    }

    return value
  }

  private normalizePossibleFilesystemPath(value: string): string {
    const trimmedValue = value.trim()
    if (
      !trimmedValue ||
      trimmedValue.includes('\n') ||
      trimmedValue.includes('\r')
    ) {
      return value
    }

    try {
      const parsedUrl = new URL(trimmedValue)
      if (parsedUrl.protocol) {
        return value
      }
    } catch {
      // Not a valid URL, continue.
    }

    const resolvedPath = this.resolveFilesystemPathCandidate(trimmedValue)
    return resolvedPath || value
  }

  private resolveFilesystemPathCandidate(value: string): string | null {
    if (
      ABSOLUTE_OR_HOME_PATH_PATTERN.test(value) ||
      EXPLICIT_RELATIVE_PATH_PATTERN.test(value)
    ) {
      return this.correctHomePath(this.resolveAbsoluteLikePath(value))
    }

    const existingCandidate = this.buildFilesystemCandidates(value).find(
      (candidate) => fs.existsSync(candidate)
    )
    if (existingCandidate) {
      return path.normalize(existingCandidate)
    }

    return null
  }

  private resolveAbsoluteLikePath(value: string): string {
    if (value === '~') {
      return os.homedir()
    }

    if (value.startsWith('~/') || value.startsWith('~\\')) {
      return path.join(os.homedir(), value.slice(2))
    }

    if (path.isAbsolute(value)) {
      return path.normalize(value)
    }

    return path.resolve(process.cwd(), value)
  }

  private buildFilesystemCandidates(value: string): string[] {
    const homeDirectory = os.homedir()
    const cwdCandidate = path.resolve(process.cwd(), value)
    const homeCandidate = path.resolve(homeDirectory, value)
    const downloadsCandidate = path.resolve(
      path.join(homeDirectory, 'Downloads'),
      value
    )
    const desktopCandidate = path.resolve(
      path.join(homeDirectory, 'Desktop'),
      value
    )

    return [...new Set([
      cwdCandidate,
      downloadsCandidate,
      desktopCandidate,
      homeCandidate
    ])]
  }

  private correctHomePath(candidate: string): string {
    const currentHome = path.normalize(os.homedir())
    if (!currentHome || !path.isAbsolute(candidate)) {
      return candidate
    }

    const currentHomeParent = path.dirname(currentHome)
    const currentHomeName = path.basename(currentHome)
    if (
      !currentHomeParent ||
      currentHomeParent === currentHome ||
      !candidate.startsWith(`${currentHomeParent}${path.sep}`)
    ) {
      return candidate
    }

    const relativeFromHomeParent = path.relative(currentHomeParent, candidate)
    const pathParts = relativeFromHomeParent
      .split(path.sep)
      .filter(Boolean)

    if (pathParts.length < 2) {
      return candidate
    }

    const candidateHomeName = pathParts[0]
    if (!candidateHomeName || candidateHomeName === currentHomeName) {
      return candidate
    }

    return path.normalize(path.join(currentHome, ...pathParts.slice(1)))
  }

  private async applyResponseJQ(
    output: Record<string, unknown>,
    filter: string
  ): Promise<Record<string, unknown>> {
    const resolvedInput = await this.resolveResponseJQInput(output)
    if (resolvedInput === null) {
      throw new Error(
        'This tool did not return JSON output, a JSON string, or a JSON file path.'
      )
    }

    const projected = await jq.run(filter, resolvedInput.input, {
      input: 'json',
      output: 'json'
    })

    if (resolvedInput.sourceJsonFilePath) {
      await fs.promises.writeFile(
        resolvedInput.sourceJsonFilePath,
        this.serializeProjectedResultForFile(projected),
        'utf8'
      )
    }

    return {
      result: projected
    }
  }

  private async resolveResponseJQInput(
    output: Record<string, unknown>
  ): Promise<{
    input: NodeJQJson
    sourceJsonFilePath: string | null
  } | null> {
    const resultValue = output['result']
    const resolvedResult = await this.resolveJsonLikeValue(resultValue)
    if (resolvedResult !== null) {
      return {
        input: {
          ...output,
          result: resolvedResult.value
        } as NodeJQJson,
        sourceJsonFilePath: resolvedResult.sourceJsonFilePath
      }
    }

    return {
      input: output as NodeJQJson,
      sourceJsonFilePath: null
    }
  }

  private async resolveJsonLikeValue(value: unknown): Promise<{
    value: NodeJQJson
    sourceJsonFilePath: string | null
  } | null> {
    if (value == null) {
      return null
    }

    if (Array.isArray(value) || typeof value === 'object') {
      return {
        value: value as NodeJQJson,
        sourceJsonFilePath: null
      }
    }

    if (typeof value !== 'string') {
      return null
    }

    const trimmed = value.trim()
    if (!trimmed) {
      return null
    }

    const inlineJson = this.parseJsonValue(trimmed)
    if (inlineJson !== null) {
      return {
        value: inlineJson,
        sourceJsonFilePath: null
      }
    }

    const filePath = this.normalizePossibleFilesystemPath(trimmed).trim() || trimmed

    try {
      const stat = await fs.promises.stat(filePath)
      if (!stat.isFile()) {
        return null
      }

      const fileContent = await fs.promises.readFile(filePath, 'utf8')
      const parsedFileContent = this.parseJsonValue(fileContent)
      if (parsedFileContent === null) {
        return null
      }

      return {
        value: parsedFileContent,
        sourceJsonFilePath: filePath
      }
    } catch {
      return null
    }
  }

  private serializeProjectedResultForFile(value: unknown): string {
    if (typeof value === 'string') {
      return value
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value)
    }

    return JSON.stringify(value, null, 2)
  }

  private parseJsonValue(value: string): NodeJQJson | null {
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  }

  private mapArgs(
    argsObject: Record<string, unknown>,
    parameters?: Record<string, unknown>
  ): unknown[] {
    const properties =
      parameters &&
      typeof parameters === 'object' &&
      parameters['properties'] &&
      typeof parameters['properties'] === 'object'
        ? (parameters['properties'] as Record<string, unknown>)
        : null

    if (!properties) {
      return Object.values(argsObject)
    }

    const requiredList = Array.isArray(parameters?.['required'])
      ? (parameters?.['required'] as string[])
      : []
    const orderedKeys = Object.keys(properties)
    const missingRequired = requiredList.filter(
      (key) => argsObject[key] === undefined
    )

    if (missingRequired.length > 0) {
      throw new Error(
        `Missing required tool_input fields: ${missingRequired.join(', ')}`
      )
    }

    if (requiredList.length > 0) {
      const lastRequiredIndex = Math.max(
        ...requiredList.map((key) => orderedKeys.indexOf(key))
      )
      const optionalBeforeRequired = orderedKeys
        .slice(0, lastRequiredIndex)
        .filter((key) => !requiredList.includes(key))

      if (optionalBeforeRequired.length > 0) {
        throw new Error(
          `Optional parameters must be trailing: ${optionalBeforeRequired.join(
            ', '
          )}`
        )
      }
    }

    const orderedArgs = orderedKeys.map((key) => argsObject[key])
    while (orderedArgs.length > 0) {
      const lastIndex = orderedArgs.length - 1
      if (orderedArgs[lastIndex] !== undefined) {
        break
      }
      orderedArgs.pop()
    }
    return orderedArgs
  }

  private async runToolRuntime(params: {
    toolkitId: string
    toolId: string
    functionName: string
    args: unknown[]
  }): Promise<{
    success: boolean
    message: string
    output: Record<string, unknown>
  }> {
    const nodeArgs = [
      TSX_CLI_PATH,
      '--tsconfig',
      path.join(NODEJS_BRIDGE_ROOT_PATH, 'tsconfig.json'),
      NODEJS_BRIDGE_TOOL_RUNTIME_SRC_PATH
    ]

    const cliArgs = [
      ...nodeArgs,
      '--runtime',
      'tool',
      '--toolkit',
      params.toolkitId,
      '--tool',
      params.toolId,
      '--function',
      params.functionName,
      '--args',
      JSON.stringify(params.args)
    ]

    try {
      const { stdout, stderr } = await execFileAsync(
        NODE_RUNTIME_BIN_PATH,
        cliArgs,
        {
          cwd: NODEJS_BRIDGE_ROOT_PATH,
          maxBuffer: 1_024 * 1_024 * 10,
          env: {
            ...process.env,
            LEON_CODEBASE_PATH: CODEBASE_PATH
          }
        }
      )
      const output = stdout ? stdout.toString().trim() : ''
      const runtimeStderr = stderr ? stderr.toString() : ''
      this.logToolRuntimeMessages(
        params.toolkitId,
        params.toolId,
        runtimeStderr
      )
      if (!output) {
        return {
          success: false,
          message: 'Tool runtime returned empty output.',
          output: {
            runtime_stdout: stdout ? stdout.toString() : '',
            runtime_stderr: runtimeStderr
          }
        }
      }

      try {
        const parsed = JSON.parse(output) as {
          success: boolean
          message: string
          output?: Record<string, unknown>
        }
        return {
          success: Boolean(parsed.success),
          message: parsed.message || 'Tool runtime error.',
          output: parsed.output || {}
        }
      } catch (parseError) {
        return {
          success: false,
          message: `Tool runtime returned invalid JSON: ${
            (parseError as Error).message
          }`,
          output: {
            runtime_stdout: stdout ? stdout.toString() : '',
            runtime_stderr: runtimeStderr
          }
        }
      }
    } catch (error) {
      const execError = error as Error & {
        stdout?: Buffer | string
        stderr?: Buffer | string
      }
      const runtimeStdout = execError.stdout ? execError.stdout.toString() : ''
      const runtimeStderr = execError.stderr ? execError.stderr.toString() : ''
      this.logToolRuntimeMessages(
        params.toolkitId,
        params.toolId,
        runtimeStderr
      )
      if (runtimeStdout) {
        try {
          const parsed = JSON.parse(runtimeStdout) as {
            success: boolean
            message: string
            output?: Record<string, unknown>
          }
          return {
            success: Boolean(parsed.success),
            message: parsed.message || 'Tool runtime error.',
            output: {
              ...(parsed.output || {}),
              runtime_stderr: runtimeStderr
            }
          }
        } catch {
          // Fall through to stderr message
        }
      }
      const stderrMessage = runtimeStderr.trim()
      const message = stderrMessage
        ? `Tool runtime error: ${stderrMessage}`
        : `Tool runtime error: ${execError.message}`
      return {
        success: false,
        message,
        output: {
          runtime_stdout: runtimeStdout,
          runtime_stderr: runtimeStderr
        }
      }
    }
  }
}
