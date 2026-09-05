import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  BRAIN,
  SOCKET_SERVER,
  TOOL_EXECUTOR,
  TOOLKIT_REGISTRY
} from '@/core'
import { COMPUTER_USE_PROVIDER_ID } from '@/core/computer-use/constants'
import { LogHelper } from '@/helpers/log-helper'
import { RuntimeHelper } from '@/helpers/runtime-helper'
import { SystemHelper } from '@/helpers/system-helper'
import { LEON_HOME_PATH } from '@/leon-roots'

import { DUTY_NAME } from './constants'
import { buildBoundedToolObservation } from './agent-context-budget'
import type { AgentRunProgressEvent, ToolExecutionResult } from './types'
import {
  extractFinalAnswerFromToolResult,
  formatFilePath
} from './utils'

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

const TOOL_PREPARATION_STARTED_REPORT_KEYS = new Set([
  'bridges.tools.creating_bins_directory',
  'bridges.tools.binary_not_found',
  'bridges.tools.downloading_from_url',
  'bridges.tools.download_progress',
  'bridges.tools.download_progress_with_details',
  'bridges.tools.extracting_archive',
  'bridges.tools.making_executable',
  'bridges.tools.removing_quarantine',
  'bridges.tools.creating_resource_directory',
  'bridges.tools.downloading_resource',
  'bridges.tools.downloading_resource_file'
])
const TOOL_PREPARATION_READY_REPORT_KEYS = new Set([
  'bridges.tools.binary_ready',
  'bridges.tools.resource_downloaded'
])
const TOOL_PREPARATION_FAILED_REPORT_KEYS = new Set([
  'bridges.tools.no_binary_url',
  'bridges.tools.no_resource_urls',
  'bridges.tools.download_failed',
  'bridges.tools.download_url_failed',
  'bridges.tools.resource_file_download_failed'
])
function stringifyToolPanelValue(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return '(empty)'
    }

    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2)
    } catch {
      return trimmed
    }
  }

  if (typeof value === 'undefined') {
    return '(empty)'
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function createToolGroupId(
  toolkitId: string,
  toolId: string,
  functionName: string
): string {
  return `agent_${toolkitId}_${toolId}_${functionName}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function getToolDisplayContext(
  toolkitId: string,
  toolId: string,
  functionName: string
): {
  toolkitName: string
  toolName: string
  toolkitIconName?: string
  toolIconName?: string
  key: string
} {
  const resolvedTool = TOOLKIT_REGISTRY.resolveToolById(toolId, toolkitId)

  return {
    toolkitName: resolvedTool?.toolkitName || toolkitId,
    toolName: resolvedTool?.toolName || toolId,
    ...(resolvedTool?.toolkitIconName
      ? { toolkitIconName: resolvedTool.toolkitIconName }
      : {}),
    ...(resolvedTool?.toolIconName
      ? { toolIconName: resolvedTool.toolIconName }
      : {}),
    key: `${toolkitId}.${toolId}.${functionName}`
  }
}

function emitToolExecutionInputToWebApp(params: {
  toolkitId: string
  toolId: string
  functionName: string
  toolInput: string
  toolGroupId: string
  toolCallTitle?: string
  stepLabel?: string
}): void {
  const displayContext = getToolDisplayContext(
    params.toolkitId,
    params.toolId,
    params.functionName
  )
  const prefixLines = params.stepLabel
    ? [`Step: ${params.stepLabel}`, '']
    : []
  const inputMessage = [
    ...prefixLines,
    'Input:',
    stringifyToolPanelValue(params.toolInput)
  ].join('\n')

  SOCKET_SERVER.emitAnswerToChatClients({
    answer: inputMessage,
    isToolOutput: true,
    toolDisplayMode: 'activity_card',
    toolPhase: 'input',
    ...displayContext,
    toolGroupId: params.toolGroupId,
    functionName: params.functionName,
    toolInput: params.toolInput,
    ...(params.toolCallTitle
      ? { toolCallTitle: params.toolCallTitle }
      : {}),
    ...(params.stepLabel ? { stepLabel: params.stepLabel } : {})
  })
}

function emitToolPreparationProgressToWebApp(params: {
  toolkitId: string
  toolId: string
  functionName: string
  toolGroupId: string
  message: string
  toolCallTitle?: string
  stepLabel?: string
}): void {
  const message = params.message.trim()
  if (!message) {
    return
  }

  SOCKET_SERVER.emitAnswerToChatClients({
    answer: message,
    isToolOutput: true,
    toolDisplayMode: 'activity_card',
    toolPhase: 'preparation',
    ...getToolDisplayContext(
      params.toolkitId,
      params.toolId,
      params.functionName
    ),
    toolGroupId: params.toolGroupId,
    functionName: params.functionName,
    status: 'running',
    message,
    ...(params.toolCallTitle
      ? { toolCallTitle: params.toolCallTitle }
      : {}),
    ...(params.stepLabel ? { stepLabel: params.stepLabel } : {})
  })
}

function emitToolExecutionOutputDeltaToWebApp(params: {
  toolkitId: string
  toolId: string
  functionName: string
  toolGroupId: string
  output: string
  toolCallTitle?: string
  stepLabel?: string
}): void {
  const output = params.output
  if (!output.trim()) {
    return
  }

  SOCKET_SERVER.emitAnswerToChatClients({
    answer: output,
    isToolOutput: true,
    toolDisplayMode: 'activity_card',
    toolPhase: 'output_delta',
    ...getToolDisplayContext(
      params.toolkitId,
      params.toolId,
      params.functionName
    ),
    toolGroupId: params.toolGroupId,
    functionName: params.functionName,
    status: 'running',
    outputDelta: output,
    ...(params.toolCallTitle
      ? { toolCallTitle: params.toolCallTitle }
      : {}),
    ...(params.stepLabel ? { stepLabel: params.stepLabel } : {})
  })
}

function emitToolPreparationOwnerMessage(
  key: string,
  toolName: string
): void {
  const message = BRAIN.wernicke(key, '', {
    '{{ tool_name }}': toolName
  })
  if (!message) {
    return
  }

  void BRAIN.talk(message).catch((error) => {
    LogHelper.title(`${DUTY_NAME} / execution`)
    LogHelper.warning(
      `Failed to emit tool preparation owner message: ${String(error)}`
    )
  })
}

function emitToolExecutionOutputToWebApp(params: {
  toolkitId: string
  toolId: string
  functionName: string
  toolGroupId: string
  output: Record<string, unknown>
  status: string
  message: string
  toolCallTitle?: string
  stepLabel?: string
}): void {
  const outputPayload = {
    status: params.status,
    message: params.message,
    output: params.output
  }
  const outputMessage = [
    `Output (${params.status}):`,
    stringifyToolPanelValue(outputPayload)
  ].join('\n')

  SOCKET_SERVER.emitAnswerToChatClients({
    answer: outputMessage,
    isToolOutput: true,
    toolDisplayMode: 'activity_card',
    toolPhase: 'output',
    ...getToolDisplayContext(
      params.toolkitId,
      params.toolId,
      params.functionName
    ),
    toolGroupId: params.toolGroupId,
    functionName: params.functionName,
    status: params.status,
    message: params.message,
    output: params.output,
    ...(params.toolCallTitle
      ? { toolCallTitle: params.toolCallTitle }
      : {}),
    ...(params.stepLabel ? { stepLabel: params.stepLabel } : {})
  })
}

export async function runToolExecution(
  toolkitId: string,
  toolId: string,
  functionName: string,
  toolInput: string,
  parsedInput?: Record<string, unknown>,
  stepLabel?: string,
  toolCallTitle?: string,
  onProgressEvent?: (
    event: Extract<AgentRunProgressEvent, { type: 'tool_call' }>['toolCall']
  ) => void
): Promise<ToolExecutionResult> {
  const qualifiedName = `${toolkitId}.${toolId}.${functionName}`
  const requestedToolInput = toolInput

  const toolExecutionInput: {
    toolId: string
    toolkitId: string
    functionName: string
    toolInput: string
    parsedInput?: Record<string, unknown>
    onProgress?: (progress: {
      message: string
      key?: string
      data?: Record<string, unknown>
    }) => void
  } = {
    toolId,
    toolkitId,
    functionName,
    toolInput
  }

  if (parsedInput) {
    toolExecutionInput.parsedInput = parsedInput
  }

  if (!toolExecutionInput.parsedInput) {
    try {
      const parsedToolInput = JSON.parse(toolInput)
      if (
        parsedToolInput &&
        typeof parsedToolInput === 'object' &&
        !Array.isArray(parsedToolInput)
      ) {
        toolExecutionInput.parsedInput =
          parsedToolInput as Record<string, unknown>
      }
    } catch {
      // Leave parsedInput unset; downstream validation will surface invalid JSON.
    }
  }

  // For shell commands, write the command to a temp script file so that
  // base-tool's argument escaping does not destroy shell metacharacters
  // (quotes, pipes, redirects, etc.). The shell tool receives a simple
  // file path instead of a raw command string.
  let shellScriptPath: string | null = null
  if (
    toolId === 'shell' &&
    functionName === 'executeCommand' &&
    toolExecutionInput.parsedInput?.['command']
  ) {
    const command = toolExecutionInput.parsedInput['command'] as string
    const scriptDir = join(tmpdir(), 'leon_shell_scripts')
    mkdirSync(scriptDir, { recursive: true })
    const scriptExtension = SystemHelper.isWindows() ? 'ps1' : 'sh'
    shellScriptPath = join(
      scriptDir,
      `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${scriptExtension}`
    )
    const escapedLeonHomePath = SystemHelper.isWindows()
      ? LEON_HOME_PATH.replaceAll('\'', '\'\'')
      : LEON_HOME_PATH.replaceAll('"', '\\"')
    const scriptContent = SystemHelper.isWindows()
      ? [
        '# Leon-injected managed runtime shims. This block is not generated by the LLM.',
        `$env:LEON_HOME = '${escapedLeonHomePath}'`,
        `$env:LEON_HOME_PATH = '${escapedLeonHomePath}'`,
        '',
        RuntimeHelper.buildManagedRuntimePowerShellFunctions(),
        '',
        '# LLM-generated PowerShell command starts here.',
        '$ErrorActionPreference = "Stop"',
        command,
        ''
      ].join('\n')
      : [
        '# Leon-injected managed runtime shims. This block is not generated by the LLM.',
        `export LEON_HOME="${escapedLeonHomePath}"`,
        `export LEON_HOME_PATH="${escapedLeonHomePath}"`,
        '',
        RuntimeHelper.buildManagedRuntimeShellFunctions(),
        '',
        '# LLM-generated shell command starts here.',
        'set -e',
        command,
        ''
      ].join('\n')

    writeFileSync(
      shellScriptPath,
      scriptContent,
      { mode: 0o755 }
    )

    // Replace the command with the script path
    toolExecutionInput.parsedInput = {
      ...toolExecutionInput.parsedInput,
      command: shellScriptPath
    }
    toolExecutionInput.toolInput = JSON.stringify(
      toolExecutionInput.parsedInput
    )
  }

  LogHelper.title(`${DUTY_NAME} / execution`)
  LogHelper.debug(`Running tool: ${qualifiedName}`)
  LogHelper.debug(`Tool input: ${toolInput}`)

  const toolGroupId = createToolGroupId(toolkitId, toolId, functionName)
  const toolDisplayContext = getToolDisplayContext(
    toolkitId,
    toolId,
    functionName
  )
  onProgressEvent?.({
    id: toolGroupId,
    name: qualifiedName,
    status: 'running',
    ...(toolDisplayContext.toolkitIconName
      ? { toolkitIconName: toolDisplayContext.toolkitIconName }
      : {}),
    ...(toolDisplayContext.toolIconName
      ? { toolIconName: toolDisplayContext.toolIconName }
      : {}),
    input: requestedToolInput,
    ...(stepLabel ? { stepLabel } : {})
  })
  emitToolExecutionInputToWebApp({
    toolkitId,
    toolId,
    functionName,
    toolInput: requestedToolInput,
    toolGroupId,
    ...(toolCallTitle ? { toolCallTitle } : {}),
    ...(stepLabel ? { stepLabel } : {})
  })

  let didNotifyOwnerPreparationStarted = false
  let didNotifyOwnerPreparationReady = false
  let didObservePreparationFailure = false
  toolExecutionInput.onProgress = (progress): void => {
    onProgressEvent?.({
      id: toolGroupId,
      name: qualifiedName,
      status: 'running',
      ...(toolDisplayContext.toolkitIconName
        ? { toolkitIconName: toolDisplayContext.toolkitIconName }
        : {}),
      ...(toolDisplayContext.toolIconName
        ? { toolIconName: toolDisplayContext.toolIconName }
        : {}),
      input: requestedToolInput,
      output: progress.data || progress.message,
      ...(stepLabel ? { stepLabel } : {})
    })
    if (progress.key === 'bridges.tools.command_output_delta') {
      const output =
        typeof progress.data?.['output'] === 'string'
          ? progress.data['output']
          : progress.message
      emitToolExecutionOutputDeltaToWebApp({
        toolkitId,
        toolId,
        functionName,
        toolGroupId,
        output,
        ...(toolCallTitle ? { toolCallTitle } : {}),
        ...(stepLabel ? { stepLabel } : {})
      })
      return
    }

    emitToolPreparationProgressToWebApp({
      toolkitId,
      toolId,
      functionName,
      toolGroupId,
      message: progress.message,
      ...(toolCallTitle ? { toolCallTitle } : {}),
      ...(stepLabel ? { stepLabel } : {})
    })

    if (!progress.key) {
      return
    }

    if (TOOL_PREPARATION_FAILED_REPORT_KEYS.has(progress.key)) {
      didObservePreparationFailure = true
      return
    }

    if (
      !didNotifyOwnerPreparationStarted &&
      TOOL_PREPARATION_STARTED_REPORT_KEYS.has(progress.key)
    ) {
      didNotifyOwnerPreparationStarted = true
      emitToolPreparationOwnerMessage(
        'react.tool.preparing',
        toolDisplayContext.toolName
      )
      return
    }

    if (
      didNotifyOwnerPreparationStarted &&
      !didNotifyOwnerPreparationReady &&
      !didObservePreparationFailure &&
      TOOL_PREPARATION_READY_REPORT_KEYS.has(progress.key)
    ) {
      didNotifyOwnerPreparationReady = true
      emitToolPreparationOwnerMessage(
        'react.tool.ready',
        toolDisplayContext.toolName
      )
    }
  }

  const toolExecutionResult =
    await TOOL_EXECUTOR.executeTool(toolExecutionInput)
  const modelFiles = toolExecutionResult.data.model_files
  const observationData = { ...toolExecutionResult.data }
  delete observationData.model_files
  // The assistant tool call already carries its input. Avoid duplicating both
  // serialized and parsed forms in the bounded observation so useful output
  // remains inline instead of forcing an artifact-log read.
  delete observationData.input
  delete observationData.parsed_input
  const outputLogPath =
    typeof toolExecutionResult.data?.output_log_path === 'string'
      ? toolExecutionResult.data.output_log_path
      : null
  const toolOutput = toolExecutionResult.data?.output || {}
  const nestedResult = asRecord(toolOutput['result'])
  const toolOutputSuccess = toolOutput['success']
  const nestedResultSuccess = nestedResult?.['success']
  const toolOutputError =
    typeof toolOutput['error'] === 'string'
      ? toolOutput['error']
      : null
  const nestedResultError =
    typeof nestedResult?.['error'] === 'string'
      ? nestedResult['error']
      : null
  const hasObservedToolFailure =
    toolExecutionResult.status === 'success' &&
    (toolOutputSuccess === false || nestedResultSuccess === false)
  const effectiveStatus = hasObservedToolFailure
    ? 'observed'
    : toolExecutionResult.status
  const effectiveMessage =
    (hasObservedToolFailure && (nestedResultError || toolOutputError)) ||
    toolExecutionResult.message

  LogHelper.title(`${DUTY_NAME} / execution`)
  if (hasObservedToolFailure) {
    LogHelper.warning(
      'Tool result kept as [observed]: tool output reported success=false'
    )
  }
  if (effectiveStatus === 'error') {
    LogHelper.debug(
      `Tool result: ${qualifiedName} [${effectiveStatus}] — ${effectiveMessage}`
    )
  }
  LogHelper.debug(
    `Tool output: ${JSON.stringify(toolExecutionResult.data?.output)}`
  )

  emitToolExecutionOutputToWebApp({
    toolkitId,
    toolId,
    functionName,
    toolGroupId,
    output: toolExecutionResult.data?.output || {},
    status: effectiveStatus,
    message: effectiveMessage,
    ...(toolCallTitle ? { toolCallTitle } : {}),
    ...(stepLabel ? { stepLabel } : {})
  })
  onProgressEvent?.({
    id: toolGroupId,
    name: qualifiedName,
    status: effectiveStatus === 'error' ? 'error' : 'success',
    ...(toolDisplayContext.toolkitIconName
      ? { toolkitIconName: toolDisplayContext.toolkitIconName }
      : {}),
    ...(toolDisplayContext.toolIconName
      ? { toolIconName: toolDisplayContext.toolIconName }
      : {}),
    input: requestedToolInput,
    output: toolExecutionResult.data?.output || {},
    ...(stepLabel ? { stepLabel } : {}),
    ...(effectiveStatus === 'error'
      ? { errorMessage: effectiveMessage }
      : {})
  })

  // Check for final_answer in tool result
  const finalAnswer =
    effectiveStatus === 'success'
      ? extractFinalAnswerFromToolResult(toolExecutionResult)
      : null
  if (finalAnswer) {
    return {
      execution: {
        function: qualifiedName,
        status: 'success',
        observation: finalAnswer,
        requestedToolInput,
        ...(stepLabel ? { stepLabel } : {})
      },
      ...(modelFiles ? { modelFiles } : {}),
      handoffSignal: {
        intent: 'answer',
        draft: finalAnswer
      }
    }
  }

  // Check for missing settings
  const missingSettings =
    effectiveStatus !== 'success'
      ? ((toolOutput['missing_settings'] as
          | string[]
          | undefined) ??
        (nestedResult?.['missing_settings'] as
          | string[]
          | undefined))
      : undefined
  const settingsPath =
    effectiveStatus !== 'success'
      ? ((toolOutput['settings_path'] as
          | string
          | undefined) ??
        (nestedResult?.['settings_path'] as
          | string
          | undefined))
      : undefined
  if (missingSettings && missingSettings.length > 0 && settingsPath) {
    const formattedPath = formatFilePath(settingsPath)
    return {
      execution: {
        function: qualifiedName,
        status: 'error',
        observation: `Missing settings: ${missingSettings.join(', ')}`,
        requestedToolInput,
        ...(stepLabel ? { stepLabel } : {})
      },
      handoffSignal: {
        intent: 'blocked',
        draft: `Missing tool settings: ${missingSettings.join(
          ', '
        )}. Please set them in ${formattedPath}.`
      }
    }
  }

  const observation = buildBoundedToolObservation({
    status: effectiveStatus,
    ...(effectiveStatus !== toolExecutionResult.status
      ? { raw_status: toolExecutionResult.status }
      : {}),
    // Computer-use observations already expose a bounded result and focused
    // query path. Keeping the full-log pointer encourages expensive reads of
    // stale snapshots; retain it only for failures where diagnostics matter.
    ...(outputLogPath &&
      (toolkitId !== COMPUTER_USE_PROVIDER_ID ||
        effectiveStatus === 'error')
      ? { output_log_path: outputLogPath }
      : {}),
    message: effectiveMessage,
    data: observationData,
    ...(hasObservedToolFailure
      ? {
        observed_tool_failure: {
          success: nestedResultSuccess ?? toolOutputSuccess,
          error: nestedResultError || toolOutputError || effectiveMessage
        }
      }
      : {})
  })

  return {
    execution: {
      function: qualifiedName,
      status: effectiveStatus,
      observation,
      requestedToolInput,
      ...(stepLabel ? { stepLabel } : {})
    },
    ...(modelFiles ? { modelFiles } : {})
  }
}
