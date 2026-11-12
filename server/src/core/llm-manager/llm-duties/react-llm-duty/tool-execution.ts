import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { runTurnPhase, TurnPhase } from '../../turn-timing'

import {
  SOCKET_SERVER,
  TOOL_EXECUTOR,
  TOOLKIT_REGISTRY
} from '@/core'
import { LogHelper } from '@/helpers/log-helper'
import { RuntimeHelper } from '@/helpers/runtime-helper'
import { SystemHelper } from '@/helpers/system-helper'
import { getConnectionRequirements } from '@/core/connections/connection-catalog'
import { LEON_HOME_PATH } from '@/leon-roots'
import { ToolExecutionOrigin } from '@/types'
import type { ToolRuntimeProgress } from '@@/bridges/runtime/contracts/tool-runtime-types'
import { ToolRuntimePhase } from '@@/bridges/runtime/contracts/tool-runtime-types'
import { PreparationStatus, type ToolPreparationSnapshot } from '@@/aurora/src/v2/contracts/preparation'
import type { ToolExecutionInput } from '@/core/tool-manager/tool-executor'

import { DUTY_NAME } from './agent-constants'
import { buildBoundedToolObservation } from './agent-context-budget'
import type { AgentRunProgressEvent, ToolExecutionResult } from './agent-types'
import {
  extractFinalAnswerFromToolResult,
  extractOwnerActionHandoffFromToolResult,
  formatFilePath
} from './agent-utils'

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

const COMMAND_OUTPUT_MAX_TRACE_CHARS = 80_000
const TOOL_PREPARATION_STARTED_REPORT_KEYS = new Set([
  'bridges.tools.creating_bins_directory',
  'bridges.tools.binary_not_found',
  'bridges.tools.downloading_from_url',
  'bridges.tools.download_progress',
  'bridges.tools.download_progress_with_details',
  'bridges.tools.extracting_archive',
  'bridges.tools.applying_permissions',
  'bridges.tools.making_executable',
  'bridges.tools.removing_quarantine',
  'bridges.tools.creating_resource_directory',
  'bridges.tools.downloading_resource',
  'bridges.tools.downloading_resource_file'
])
const TOOL_PREPARATION_FAILED_REPORT_KEYS = new Set([
  'bridges.tools.no_binary_url',
  'bridges.tools.no_resource_urls',
  'bridges.tools.download_failed',
  'bridges.tools.download_url_failed',
  'bridges.tools.resource_file_download_failed'
])
const TOOL_PREPARATION_MILESTONE_REPORT_KEYS = new Set([
  'bridges.tools.binary_not_found',
  'bridges.tools.downloading_resource_file',
  'bridges.tools.resource_downloaded',
  'bridges.tools.download_completed',
  'bridges.tools.extracting_archive',
  'bridges.tools.archive_extracted',
  'bridges.tools.making_executable',
  'bridges.tools.binary_ready'
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

/**
 * Resolves the registry labels and icons shared by live cards and saved traces.
 */
export function getToolDisplayContext(
  toolkitId: string,
  toolId: string,
  functionName: string
): {
  toolkitName: string
  toolName: string
  toolkitIconName?: string
  toolIconName?: string
  toolLogo?: import('@@/aurora/src/contracts/package-logo').MaskedPackageLogo
  key: string
} {
  const resolvedTool = TOOLKIT_REGISTRY.resolveToolById(toolId, toolkitId)
  const toolLogo = TOOLKIT_REGISTRY.getToolIconLogo(toolkitId, toolId)

  return {
    toolkitName: resolvedTool?.toolkitName || toolkitId,
    toolName: resolvedTool?.toolName || toolId,
    ...(toolLogo ? { toolLogo } : {}),
    ...(resolvedTool?.toolkitIconName
      ? { toolkitIconName: resolvedTool.toolkitIconName }
      : {}),
    ...(resolvedTool?.toolIconName
      ? { toolIconName: resolvedTool.toolIconName }
      : {}),
    key: `${toolkitId}.${toolId}.${functionName}`
  }
}

/**
 * Updates the same activity card as arguments arrive and execution begins.
 */
export function emitToolExecutionInputToWebApp(params: {
  toolkitId: string
  toolId: string
  functionName: string
  toolInput: string
  toolGroupId: string
  status?: 'preparing' | 'running'
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
    status: params.status || 'running',
    ...(params.status !== 'preparing' ? { startedAt: Date.now() } : {}),
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

function emitToolProgressToWebApp(params: {
  toolkitId: string
  toolId: string
  functionName: string
  toolGroupId: string
  message: string
  phase: 'preparation' | 'progress'
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
    toolPhase: params.phase,
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

/**
 * Settles an activity card with an execution outcome or an unused preview.
 */
export function emitToolExecutionOutputToWebApp(params: {
  toolkitId: string
  toolId: string
  functionName: string
  toolGroupId: string
  output: Record<string, unknown>
  status: string
  message: string
  durationMs?: number
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
    ...(params.durationMs !== undefined ? { durationMs: params.durationMs } : {}),
    ...(params.toolCallTitle
      ? { toolCallTitle: params.toolCallTitle }
      : {}),
    ...(params.stepLabel ? { stepLabel: params.stepLabel } : {})
  })
}

/**
 * Runs an agent tool call and keeps retained downloads and output on their originating call.
 */
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
  ) => void,
  signal?: AbortSignal,
  streamedToolGroupId?: string,
  retainedSignal?: AbortSignal
): Promise<ToolExecutionResult> {
  signal?.throwIfAborted()
  const qualifiedName = `${toolkitId}.${toolId}.${functionName}`
  const requestedToolInput = toolInput

  const toolExecutionInput: ToolExecutionInput = {
    origin: ToolExecutionOrigin.Agent,
    ...(signal ? { signal } : {}),
    ...(retainedSignal ? { retainedSignal } : {}),
    toolId,
    toolkitId,
    functionName,
    retainExecution: true,
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
        // Preserve Bash semantics: an absent optional program must not abort a scan.
        // Commands that require fail-fast behavior can explicitly enable set -e.
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

  const toolGroupId = streamedToolGroupId || createToolGroupId(toolkitId, toolId, functionName)
  const toolDisplayContext = getToolDisplayContext(
    toolkitId,
    toolId,
    functionName
  )
  onProgressEvent?.({
    id: toolGroupId,
    name: qualifiedName,
    toolkitName: toolDisplayContext.toolkitName,
    toolName: toolDisplayContext.toolName,
    ...(toolCallTitle ? { toolCallTitle } : {}),
    status: 'running',
    ...(toolDisplayContext.toolkitIconName
      ? { toolkitIconName: toolDisplayContext.toolkitIconName }
      : {}),
    ...(toolDisplayContext.toolIconName
      ? { toolIconName: toolDisplayContext.toolIconName }
      : {}),
    ...(toolDisplayContext.toolLogo ? { toolLogo: toolDisplayContext.toolLogo } : {}),
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

  let didObservePreparationStarted = false
  let didFinishToolCall = false
  let commandOutput = ''
  let progressStream: ToolRuntimeProgress['stream']
  let completedStreamProgress: ToolRuntimeProgress | undefined
  let lastPreparationProgress: ToolRuntimeProgress | undefined
  let preparation: ToolPreparationSnapshot | undefined

  function finishPreparation(success: boolean, detail: string, canceled = false): void {
    if (!preparation || preparation.status === PreparationStatus.Ready) {
      return
    }

    const downloads = preparation.downloads?.map((file) => {
      if (file.status !== 'queued' && file.status !== 'downloading') {
        return file
      }

      // A settled call cannot leave queued rows looking as though work continues.
      return { ...file, etaMs: null, status: canceled ? 'cancelled' as const : 'failed' as const }
    })

    preparation = {
      ...preparation,
      detail,
      status: success ? PreparationStatus.Ready
        : canceled ? PreparationStatus.Cancelled : PreparationStatus.Failed,
      ...(downloads ? { downloads } : {})
    }
  }

  toolExecutionInput.onProgress = (progress): void => {
    // Explicit streams belong to retained work; ordinary reports still end
    // when their call returns so unrelated reports cannot reopen settled cards.
    if (didFinishToolCall && !progress.stream) {
      return
    }

    const preparationReport = progress.phase === ToolRuntimePhase.Preparation || Boolean(progress.key && (
      TOOL_PREPARATION_STARTED_REPORT_KEYS.has(progress.key) || TOOL_PREPARATION_FAILED_REPORT_KEYS.has(progress.key) ||
      preparation && TOOL_PREPARATION_MILESTONE_REPORT_KEYS.has(progress.key)
    ))
    if (progress.downloads?.length) {
      const files = new Map(preparation?.downloads?.map((file) => [file.id, file]))
      for (const file of progress.downloads) {
        files.set(file.id, file)
      }
      const downloads = Array.from(files.values())
      const failed = downloads.some((file) => file.status === 'failed')
      const cancelled = downloads.some((file) => file.status === 'cancelled')
      preparation = {
        ...preparation,
        status: failed ? PreparationStatus.Failed : cancelled ? PreparationStatus.Cancelled
          : downloads.some((file) => file.status === 'downloading')
            ? PreparationStatus.Downloading : PreparationStatus.Preparing,
        detail: failed ? 'I could not download all files.' : cancelled ? 'The download was cancelled.' : 'Getting files ready.',
        downloads,
        ...(!preparation && !preparationReport ? { purpose: 'download' as const } : {}),
        ...(progress.stream?.id ? { executionId: progress.stream.id } : {})
      }
    } else if (progress.preparationComplete && preparation?.purpose !== 'download') {
      finishPreparation(true, progress.message)
    } else if (preparationReport && progress.phase !== ToolRuntimePhase.Execution) {
      const percentage = typeof progress.data?.['percentage'] === 'number' ? progress.data['percentage'] : undefined
      const measured = percentage !== undefined && Number.isFinite(percentage) && percentage >= 0 && percentage <= 100
      preparation = {
        ...preparation,
        status: progress.key && TOOL_PREPARATION_FAILED_REPORT_KEYS.has(progress.key) ? PreparationStatus.Failed
          : measured ? PreparationStatus.Downloading : PreparationStatus.Preparing,
        detail: progress.message,
        ...(progress.stream?.id || preparation?.executionId ? { executionId: progress.stream?.id ?? preparation!.executionId! } : {}),
        ...(measured ? { completed: percentage, total: 100 } : {})
      }
    }

    if (progress.stream) {
      progressStream = progress.stream
      if (progress.stream.state !== 'running') {
        finishPreparation(progress.stream.state === 'completed', progress.message, progress.stream.canceled)
        completedStreamProgress = progress
        const status = progress.stream.state === 'completed' ? 'success' : 'error'
        const output = progress.data || {}
        const durationMs = Math.max(0, performance.now() - executionStartedAt)
        emitToolExecutionOutputToWebApp({
          toolkitId,
          toolId,
          functionName,
          toolGroupId,
          output,
          status,
          message: progress.message,
          durationMs,
          ...(toolCallTitle ? { toolCallTitle } : {}),
          ...(stepLabel ? { stepLabel } : {})
        })
        onProgressEvent?.({
          id: toolGroupId,
          name: qualifiedName,
          toolkitName: toolDisplayContext.toolkitName,
          toolName: toolDisplayContext.toolName,
          status,
          input: requestedToolInput,
          output,
          durationMs,
          commandOutput,
          progressMessage: progress.message,
          ...(preparation ? { preparation } : {}),
          ...(toolCallTitle ? { toolCallTitle } : {}),
          ...(stepLabel ? { stepLabel } : {})
        })
        return
      }
    }


    const isOutputDelta = progress.key === 'bridges.tools.command_output_delta' ||
      progress.key === 'bridges.tools.output_delta'
    const outputDelta = isOutputDelta
      ? typeof progress.data?.['output'] === 'string'
        ? progress.data['output']
        : progress.message
      : ''
    if (outputDelta) {
      // Keep a bounded tail for reconnects without growing every saved turn.
      commandOutput = (commandOutput + outputDelta).slice(-COMMAND_OUTPUT_MAX_TRACE_CHARS)
    }

    onProgressEvent?.({
      id: toolGroupId,
      name: qualifiedName,
      toolkitName: toolDisplayContext.toolkitName,
      toolName: toolDisplayContext.toolName,
      ...(toolCallTitle ? { toolCallTitle } : {}),
      status: 'running',
      ...(toolDisplayContext.toolkitIconName
        ? { toolkitIconName: toolDisplayContext.toolkitIconName }
        : {}),
      ...(toolDisplayContext.toolIconName
        ? { toolIconName: toolDisplayContext.toolIconName }
        : {}),
      ...(toolDisplayContext.toolLogo ? { toolLogo: toolDisplayContext.toolLogo } : {}),
      input: requestedToolInput,
      output: progress.data || progress.message,
      ...(preparation ? { preparation } : {}),
      ...(outputDelta
        ? { commandOutput, lastOutputAt: Date.now(), progressMessage: 'Receiving tool output...' }
        : { progressMessage: progress.message }),
      ...(stepLabel ? { stepLabel } : {})
    })
    if (isOutputDelta) {
      emitToolExecutionOutputDeltaToWebApp({
        toolkitId,
        toolId,
        functionName,
        toolGroupId,
        output: outputDelta,
        ...(toolCallTitle ? { toolCallTitle } : {}),
        ...(stepLabel ? { stepLabel } : {})
      })
      return
    }

    if (!progress.key) {
      return
    }

    const isPreparationStart =
      TOOL_PREPARATION_STARTED_REPORT_KEYS.has(progress.key)
    const isPreparationFailure =
      TOOL_PREPARATION_FAILED_REPORT_KEYS.has(progress.key)

    if (isPreparationStart) {
      didObservePreparationStarted = true
    }
    if (
      isPreparationStart || isPreparationFailure ||
      (didObservePreparationStarted && TOOL_PREPARATION_MILESTONE_REPORT_KEYS.has(progress.key))
    ) {
      lastPreparationProgress = progress
    }

    // Cached binaries also report readiness; only actual setup belongs in
    // preparation widgets.
    if (
      !isPreparationStart &&
      !isPreparationFailure &&
      !(
        didObservePreparationStarted &&
        TOOL_PREPARATION_MILESTONE_REPORT_KEYS.has(progress.key)
      )
    ) {
      emitToolProgressToWebApp({
        toolkitId,
        toolId,
        functionName,
        toolGroupId,
        message: progress.message,
        phase: 'progress',
        ...(toolCallTitle ? { toolCallTitle } : {}),
        ...(stepLabel ? { stepLabel } : {})
      })
      return
    }

    emitToolProgressToWebApp({
      toolkitId,
      toolId,
      functionName,
      toolGroupId,
      message: progress.message,
      phase: 'preparation',
      ...(toolCallTitle ? { toolCallTitle } : {}),
      ...(stepLabel ? { stepLabel } : {})
    })
  }

  // Streamed argument previews can appear before execution starts. Measure the
  // actual dispatch, including preparation, queueing, and Satellite transport.
  const executionStartedAt = performance.now()
  let toolExecutionResult: Awaited<ReturnType<typeof TOOL_EXECUTOR.executeTool>>

  try {
    toolExecutionResult = await runTurnPhase(TurnPhase.Tool, () => TOOL_EXECUTOR.executeTool(toolExecutionInput))
    // A follow-up interrupts waiting, not the retained operation. Return its
    // handle and latest report so the next inference can inspect the same work.
    if (toolExecutionResult.data.output['execution']) {
      const executionSignal = retainedSignal ?? signal
      executionSignal?.throwIfAborted()
    } else {
      signal?.throwIfAborted()
    }
  } catch (error) {
    didFinishToolCall = true
    const durationMs = Math.max(0, performance.now() - executionStartedAt)
    const reason = error instanceof Error ? error.message : String(error)
    finishPreparation(false, reason, (retainedSignal ?? signal)?.aborted)
    const message = lastPreparationProgress
      ? `${reason}\nLast preparation report (not proof of ongoing work): ${lastPreparationProgress.message}`
      : reason

    emitToolExecutionOutputToWebApp({
      toolkitId,
      toolId,
      functionName,
      toolGroupId,
      output: lastPreparationProgress ? { preparation: lastPreparationProgress } : {},
      status: 'error',
      message,
      durationMs,
      ...(toolCallTitle ? { toolCallTitle } : {}),
      ...(stepLabel ? { stepLabel } : {})
    })
    onProgressEvent?.({
      id: toolGroupId,
      name: qualifiedName,
      toolkitName: toolDisplayContext.toolkitName,
      toolName: toolDisplayContext.toolName,
      ...(toolCallTitle ? { toolCallTitle } : {}),
      status: 'error',
      durationMs,
      input: requestedToolInput,
      errorMessage: message,
      ...(preparation ? { preparation } : {}),
      ...(stepLabel ? { stepLabel } : {})
    })

    throw lastPreparationProgress ? new Error(message, { cause: error }) : error
  }

  didFinishToolCall = true
  const durationMs = Math.max(0, performance.now() - executionStartedAt)
  const modelFiles = toolExecutionResult.data.model_files
  const observationData: Partial<typeof toolExecutionResult.data> = {
    ...toolExecutionResult.data
  }
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
  delete observationData.output_log_path
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

  const isStreamRunning = progressStream?.state === 'running'
  const displayedOutput = progressStream
    ? { ...(completedStreamProgress?.data || toolOutput), execution: progressStream }
    : toolOutput
  const displayedStatus = isStreamRunning
    ? 'running'
    : progressStream?.state === 'failed' ? 'error' : effectiveStatus
  const displayedMessage = isStreamRunning
    ? lastPreparationProgress?.message || 'The tool is running. Progress will appear as it arrives.'
    : completedStreamProgress?.message || effectiveMessage

  if (!isStreamRunning) {
    finishPreparation(displayedStatus !== 'error', displayedStatus === 'error' ? displayedMessage : 'The required files are ready.',
      progressStream?.canceled)
  }

  emitToolExecutionOutputToWebApp({
    toolkitId,
    toolId,
    functionName,
    toolGroupId,
    output: displayedOutput,
    status: displayedStatus,
    message: displayedMessage,
    durationMs,
    ...(toolCallTitle ? { toolCallTitle } : {}),
    ...(stepLabel ? { stepLabel } : {})
  })
  onProgressEvent?.({
    id: toolGroupId,
    name: qualifiedName,
    toolkitName: toolDisplayContext.toolkitName,
    toolName: toolDisplayContext.toolName,
    ...(toolCallTitle ? { toolCallTitle } : {}),
    status: isStreamRunning ? 'running' : displayedStatus === 'error' ? 'error' : 'success',
    durationMs,
    ...(toolDisplayContext.toolkitIconName
      ? { toolkitIconName: toolDisplayContext.toolkitIconName }
      : {}),
    ...(toolDisplayContext.toolIconName
      ? { toolIconName: toolDisplayContext.toolIconName }
      : {}),
    ...(toolDisplayContext.toolLogo ? { toolLogo: toolDisplayContext.toolLogo } : {}),
    input: requestedToolInput,
    output: displayedOutput,
    ...(preparation ? { preparation } : {}),
    ...(stepLabel ? { stepLabel } : {}),
    ...(effectiveStatus === 'error'
      ? { errorMessage: effectiveMessage }
      : {})
  })

  const ownerActionHandoff =
    extractOwnerActionHandoffFromToolResult(toolExecutionResult)
  if (ownerActionHandoff) {
    return {
      execution: {
        function: qualifiedName,
        toolkitName: toolDisplayContext.toolkitName,
        toolName: toolDisplayContext.toolName,
        status: 'error',
        observation: ownerActionHandoff.draft,
        requestedToolInput,
        ...(stepLabel ? { stepLabel } : {})
      },
      handoffSignal: ownerActionHandoff
    }
  }

  // Check for final_answer in tool result
  const finalAnswer =
    effectiveStatus === 'success'
      ? extractFinalAnswerFromToolResult(toolExecutionResult)
      : null
  if (finalAnswer) {
    return {
      execution: {
        function: qualifiedName,
        toolkitName: toolDisplayContext.toolkitName,
        toolName: toolDisplayContext.toolName,
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

  // Let the agent explain tool-owned setup facts and pause through clarification.
  const requiredConnections = toolOutput['required_connections']

  if (
    effectiveStatus !== 'success' &&
    Array.isArray(requiredConnections) &&
    requiredConnections.length > 0
  ) {
    const providers = requiredConnections.filter(
      (provider): provider is string => typeof provider === 'string'
    )

    return {
      execution: {
        function: qualifiedName,
        toolkitName: toolDisplayContext.toolkitName,
        toolName: toolDisplayContext.toolName,
        status: 'error',
        observation: JSON.stringify({
          connection_required: true,
          required_connections: providers,
          connections: await getConnectionRequirements(providers)
        }),
        requestedToolInput,
        ...(stepLabel ? { stepLabel } : {})
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
        toolkitName: toolDisplayContext.toolkitName,
        toolName: toolDisplayContext.toolName,
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
    // Keep one reference so older observations can be bounded without losing
    // access to source evidence. Historical snapshots are not current UI state.
    ...(outputLogPath
      ? { output_log_path: outputLogPath }
      : {}),
    ...(toolOutput['execution'] ? { execution: toolOutput['execution'] } : {}),
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

  const executionHandle = toolExecutionResult.data?.output['execution'] as
    | { id?: unknown, state?: unknown }
    | undefined

  return {
    execution: {
      function: qualifiedName,
      toolkitName: toolDisplayContext.toolkitName,
      toolName: toolDisplayContext.toolName,
      status: effectiveStatus,
      observation,
      requestedToolInput,
      ...(stepLabel ? { stepLabel } : {})
    },
    ...(typeof executionHandle?.id === 'string' && typeof executionHandle.state === 'string'
      ? { executionHandle: { id: executionHandle.id, state: executionHandle.state } }
      : {}),
    ...(modelFiles ? { modelFiles } : {})
  }
}
