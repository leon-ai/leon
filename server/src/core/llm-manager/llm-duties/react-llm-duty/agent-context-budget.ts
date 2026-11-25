import type {
  AgentToolTranscriptMessage,
  OpenAITool,
  OpenAIToolCall
} from '@/core/llm-manager/types'
import { LLMProviders } from '@/core/llm-manager/types'
import type { ContextTokenBreakdown } from '../../llm-usage/context-usage'
import { runTurnPhase, TurnPhase } from '../../turn-timing'
import { AGENT_IMAGE_BATCH_MAX_BYTES, TOOL_RESULT_INLINE_MAX_CHARS } from '@/constants'
import {
  LOCAL_LLM_CONTEXT_WINDOW_TOKENS,
  isLocalLLMProvider,
  resolveAgentBudgetContextWindowTokens
} from '@/core/llm-manager/model-context-windows'

import {
  AGENT_CONTEXT_WINDOW_BUDGET_RATIO,
  AGENT_CONTEXT_RECOVERY_BUDGET_RATIO,
  AGENT_LOCAL_CONTEXT_SAFETY_MARGIN_RATIO,
  AGENT_RECENT_TOOLKIT_SCHEMA_LIMIT,
  AGENT_RECENT_TOOL_IMAGE_LIMIT,
  AGENT_TOOLKIT_LOADER_NAME,
  AGENT_TOOL_IMAGE_REMOVAL_BATCH_SIZE,
  AGENT_MODEL_IMAGE_ESTIMATED_TOKENS,
  CHARS_PER_TOKEN
} from './agent-constants'

const TOOL_NAME_SEPARATOR = '__'
const UI_TOOLKIT_IDS = ['computer_use', 'browser_use'] as const
const SUMMARY_RECENT_EXCHANGES = 8
const OLDER_UI_OBSERVATION_MAX_CHARS = 1_500
const RETAINED_RESULT_PREVIEW_MAX_CHARS = 4_096
const IMPLICIT_SOURCE_PAGE_MAX_CHARS = Math.floor(TOOL_RESULT_INLINE_MAX_CHARS / 3)
const COMMAND_OUTPUT_PREVIEW_MAX_CHARS = RETAINED_RESULT_PREVIEW_MAX_CHARS
const MAX_RETAINED_TOOL_IMAGE_BYTES = 1_024 * 1_024

interface AgentModelContextParams {
  transcript: AgentToolTranscriptMessage[]
  systemPrompt: string
  tools: OpenAITool[]
  compactionTriggerTokens: number
  forceCompaction?: boolean
  preserveToolSchemas?: boolean
}

export interface PreparedAgentModelContext {
  transcript: AgentToolTranscriptMessage[]
  tools: OpenAITool[]
  estimatedInputTokensBeforePreparation: number
  estimatedInputTokens: number
  contextTokenBreakdown: ContextTokenBreakdown
  wasCompacted: boolean
}

type AssistantToolCallMessage = Extract<
  AgentToolTranscriptMessage,
  { role: 'assistant' }
> & { toolCalls: OpenAIToolCall[] }

type ToolTranscriptMessage = Extract<
  AgentToolTranscriptMessage,
  { role: 'tool' }
>

interface CompletedToolExchange {
  startIndex: number
  endIndex: number
  assistantMessage: AssistantToolCallMessage
  toolMessages: ToolTranscriptMessage[]
}

/**
 * Leaves a quarter of the endpoint window for generation and estimation error
 * when Leon manages the context itself.
 */
export function resolveAgentContextCompactionTriggerTokens(
  provider: LLMProviders,
  contextWindowTokens?: number
): number {
  return Math.floor(
    resolveAgentBudgetContextWindowTokens(provider, contextWindowTokens) *
      AGENT_CONTEXT_WINDOW_BUDGET_RATIO
  )
}

/**
 * Targets half the window at most and makes a meaningful reduction from the
 * rejected or stalled request when its estimated size is available.
 */
export function resolveAgentContextRecoveryTriggerTokens(
  provider: LLMProviders,
  contextWindowTokens?: number,
  failedInputTokens?: number
): number {
  const capacity = resolveAgentBudgetContextWindowTokens(provider, contextWindowTokens)

  return Math.max(1, Math.floor(
    Math.min(capacity, failedInputTokens ?? capacity) * AGENT_CONTEXT_RECOVERY_BUDGET_RATIO
  ))
}

/**
 * Gives local models the context capacity left after the prepared prompt and
 * a tokenizer-estimation margin. Remote calls use their provider/SDK defaults,
 * including recovery: a fixed retry ceiling can be lower than those defaults.
 */
export function resolveAgentMaxOutputTokens(
  provider: LLMProviders,
  estimatedInputTokens: number
): number | undefined {
  if (!isLocalLLMProvider(provider)) {
    return undefined
  }

  const safetyMarginTokens = Math.floor(
    LOCAL_LLM_CONTEXT_WINDOW_TOKENS *
      AGENT_LOCAL_CONTEXT_SAFETY_MARGIN_RATIO
  )
  const boundedInputTokens = Math.max(Math.floor(estimatedInputTokens), 0)

  return Math.max(
    LOCAL_LLM_CONTEXT_WINDOW_TOKENS -
      boundedInputTokens -
      safetyMarginTokens,
    1
  )
}

function estimateTokens(value: string): number {
  return value ? Math.ceil(value.length / CHARS_PER_TOKEN) : 0
}

/**
 * Estimates the complete request, excluding encoded image bytes.
 */
export function estimateAgentInputTokens(
  transcript: AgentToolTranscriptMessage[],
  systemPrompt: string,
  tools: OpenAITool[]
): number {
  return sumContextTokens(estimateContextTokens(transcript, systemPrompt, tools))
}

function sumContextTokens(breakdown: ContextTokenBreakdown): number {
  return breakdown.transcript + breakdown.system + breakdown.tools + breakdown.images + breakdown.compaction
}

function estimateContextTokens(
  transcript: AgentToolTranscriptMessage[],
  systemPrompt: string,
  tools: OpenAITool[]
): ContextTokenBreakdown {
  let imageCount = 0
  let compactionTokens = 0
  const serializedTranscript = JSON.stringify(transcript, (key, value) => {
    if (key === 'runtimeContext' || key === 'providerMessage') {
      return undefined
    }
    if (value?.role === 'assistant' && value.compactionContext) {
      compactionTokens += value.compactionContext.estimatedTokens
      return { role: 'assistant', content: '' }
    }

    if (key === 'dataBase64' && typeof value === 'string') {
      imageCount += 1
      return ''
    }
    return value
  })

  return {
    transcript: estimateTokens(serializedTranscript),
    compaction: compactionTokens,
    images: imageCount * AGENT_MODEL_IMAGE_ESTIMATED_TOKENS,
    system: estimateTokens(systemPrompt),
    tools: estimateTokens(JSON.stringify(tools))
  }
}

/**
 * Keeps recent tool images and the latest inspection batch without changing
 * saved evidence, textual results, or owner attachments. Older results leave
 * in batches, preserving the prefix between removals with bounded headroom.
 * Oversized previews require a bounded reread; queued inspections stay intact.
 */
export function retainRecentToolImages(
  transcript: AgentToolTranscriptMessage[]
): AgentToolTranscriptMessage[] {
  const withheldPreviews: Array<{ toolCallId: string, filename?: string }> = []
  const retainedImageIndexes = new Set<number>()
  const imageIndexes = transcript.flatMap((message, index) =>
    message.role === 'tool' &&
    message.files?.some((file) => file.mediaType.startsWith('image/'))
      ? [index]
      : []
  )
  const removedCount = Math.floor(
    Math.max(0, imageIndexes.length - AGENT_RECENT_TOOL_IMAGE_LIMIT) /
      AGENT_TOOL_IMAGE_REMOVAL_BATCH_SIZE
  ) * AGENT_TOOL_IMAGE_REMOVAL_BATCH_SIZE

  for (const index of imageIndexes.slice(removedCount)) {
    retainedImageIndexes.add(index)
  }

  // Parallel inspections must reach the model together, even when their batch
  // exceeds the historical image limit.
  const latestImageExchange = findCompletedToolExchanges(transcript).findLast(
    (exchange) => exchange.toolMessages.some((message) =>
      message.files?.some((file) => file.mediaType.startsWith('image/'))
    )
  )
  if (latestImageExchange) {
    for (
      let index = latestImageExchange.startIndex + 1;
      index <= latestImageExchange.endIndex;
      index += 1
    ) {
      retainedImageIndexes.add(index)
    }
  }

  for (const index of imageIndexes) {
    const message = transcript[index]!
    if (message.role === 'tool' && message.files?.some((file) => file.inspectionPending)) {
      retainedImageIndexes.add(index)
    }
  }

  // Token estimates exclude image bytes. Remove older previews independently
  // when their encodings grow too large, keeping the current inspection whole.
  const imageBytes = (index: number): number => {
    const message = transcript[index]!

    return message.role === 'tool' ? message.files
      ?.filter((file) => file.mediaType.startsWith('image/'))
      .reduce((total, file) => total + file.dataBase64.length, 0) ?? 0 : 0
  }
  let retainedBytes = [...retainedImageIndexes].reduce(
    (total, index) => total + imageBytes(index), 0
  )

  for (const index of imageIndexes) {
    if (retainedBytes <= AGENT_IMAGE_BATCH_MAX_BYTES) {
      break
    }
    if (retainedImageIndexes.has(index) &&
      !(transcript[index] as ToolTranscriptMessage).files?.some((file) => file.inspectionPending) &&
      (!latestImageExchange || index < latestImageExchange.startIndex)) {
      retainedImageIndexes.delete(index)
      retainedBytes -= imageBytes(index)
    }
  }

  const projected = transcript.map((message, index) => {
    if (
      message.role !== 'tool' ||
      !message.files?.some((file) => file.mediaType.startsWith('image/'))
    ) {
      return message
    }

    const { files, ...textMessage } = message
    const retainedFiles = files.filter((file) => {
      if (!file.mediaType.startsWith('image/')) {
        return true
      }
      if (!file.inspectionPending &&
        Buffer.byteLength(file.dataBase64, 'base64') > MAX_RETAINED_TOOL_IMAGE_BYTES) {
        withheldPreviews.push({
          toolCallId: message.toolCallId,
          ...(file.filename ? { filename: file.filename } : {})
        })
        return false
      }

      return retainedImageIndexes.has(index)
    })
    if (retainedFiles.length === files.length) {
      return message
    }

    return retainedFiles.length > 0
      ? { ...textMessage, files: retainedFiles }
      : textMessage
  })

  if (withheldPreviews.length > 0) {
    const context = {
      withheld_image_previews: withheldPreviews,
      instruction: 'These tool previews were withheld because their encodings are too large. Their tool observations, source artifacts and canonical previews remain available. Do not claim to have inspected withheld images. Reload the relevant source with a bounded image preview before making visual judgments.'
    }
    projected.push({ role: 'user', content: JSON.stringify(context), runtimeContext: context })
  }

  return projected
}

/**
 * Old screen observations are reloadable evidence, not the current interface.
 * Bound their request-only previews while leaving original history and the
 * semantic continuation summarizer's input intact. Never trim failure details.
 */
function boundOlderUIObservations(
  transcript: AgentToolTranscriptMessage[]
): AgentToolTranscriptMessage[] {
  let recentTools = 0
  return [...transcript].reverse().map((message) => {
    if (message.role !== 'tool') return message
    recentTools += 1
    if (recentTools <= SUMMARY_RECENT_EXCHANGES ||
        !UI_TOOLKIT_IDS.some((id) => message.toolName.startsWith(`${id}${TOOL_NAME_SEPARATOR}`)) ||
        message.content.length <= OLDER_UI_OBSERVATION_MAX_CHARS) return message
    try {
      const observation = readRecord(JSON.parse(message.content))
      const outputLogPath = observation?.['output_log_path'] || readRecord(observation?.['data'])?.['output_log_path']
      if (!observation || observation['status'] !== 'success' ||
          observation['observed_tool_failure'] ||
          typeof outputLogPath !== 'string') return message
      return { ...message, content: buildBoundedToolObservation({ ...observation, output_log_path: outputLogPath }, OLDER_UI_OBSERVATION_MAX_CHARS) }
    } catch {
      return message
    }
  }).reverse()
}

/**
 * Keeps both the beginning and ending of oversized agent context text.
 */
export function createAgentTextPreview(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value
  }

  const marker = '\n...[content compacted; use the artifact path or reload the source if exact details are needed]...\n'
  const availableChars = Math.max(maxChars - marker.length, 0)
  const headChars = Math.ceil(availableChars * 0.75)
  const tailChars = availableChars - headChars

  return `${value.slice(0, headChars)}${marker}${value.slice(-tailChars)}`
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

/**
 * Keeps the first implicit text page small while preserving its exact
 * continuation offset and the source metadata. Call only for saved results.
 */
export function projectImplicitSourcePage(output: Record<string, unknown>): Record<string, unknown> {
  const result = readRecord(output['result'])
  const data = readRecord(result?.['data'])
  const offset = data?.['offsetChars']
  const total = data?.['totalChars']
  const field = typeof data?.['content'] === 'string' ? 'content' : 'text'
  const text = data?.[field]
  if (!result || !data || typeof offset !== 'number' || offset !== 0 ||
    typeof total !== 'number' || typeof text !== 'string' ||
    text.length <= IMPLICIT_SOURCE_PAGE_MAX_CHARS || total < text.length) {
    return output
  }

  const preview = text.slice(0, IMPLICIT_SOURCE_PAGE_MAX_CHARS)
  const projected: Record<string, unknown> = {
    ...data,
    [field]: preview,
    ...(typeof data['returnedChars'] === 'number' ? { returnedChars: preview.length } : {}),
    truncated: true,
    nextOffsetChars: preview.length
  }
  // The saved identity describes the complete original range.
  delete projected['modelContextId']

  return { ...output, result: { ...result, data: projected } }
}

/**
 * Prioritizes the end of an archived command's output where status and
 * diagnostics usually appear. Explicit session pages keep their requested range.
 */
export function projectCommandOutput(
  output: Record<string, unknown>,
  hasRequestedRange: boolean
): Record<string, unknown> {
  const result = readRecord(output['result'])
  const data = readRecord(result?.['data'])
  if (!result) {
    return output
  }

  const { stdout, stderr, returncode } = result
  if (typeof stdout === 'string' && typeof stderr === 'string' && typeof returncode === 'number' &&
      stdout.length + stderr.length > COMMAND_OUTPUT_PREVIEW_MAX_CHARS) {
    const stderrLimit = Math.max(COMMAND_OUTPUT_PREVIEW_MAX_CHARS - stdout.length,
      Math.floor(COMMAND_OUTPUT_PREVIEW_MAX_CHARS / 2))
    const stderrPreview = stderr.slice(-stderrLimit)
    const stdoutPreview = stdout.slice(-(COMMAND_OUTPUT_PREVIEW_MAX_CHARS - stderrPreview.length))
    const retained = typeof readRecord(output['execution'])?.['id'] === 'string'

    return { ...output, result: {
      ...result,
      stdout: stdoutPreview,
      stderr: stderrPreview,
      output_truncated: true,
      output_note: retained
        ? 'Output shows the tail of each stream. If omitted lines are needed, query the retained result by execution.id with system_utilities.tool_executions.read.'
        : 'Output shows the tail of each stream. If omitted lines are needed, read the original at output_log_path.'
    } }
  }

  if (!hasRequestedRange && data && typeof data['sessionId'] === 'string' &&
      typeof data['offsetChars'] === 'number' && typeof data['nextOffsetChars'] === 'number' &&
      typeof data['output'] === 'string' && data['output'].length > COMMAND_OUTPUT_PREVIEW_MAX_CHARS) {
    // Keep the earliest unread page so the next read resumes without a gap.
    return { ...output, result: { ...result, data: {
      ...data,
      output: data['output'].slice(0, COMMAND_OUTPUT_PREVIEW_MAX_CHARS),
      nextOffsetChars: data['offsetChars'] + COMMAND_OUTPUT_PREVIEW_MAX_CHARS,
      hasMore: true
    } } }
  }

  return output
}

/**
 * Keeps a complete tool result in its artifact log while placing only a
 * bounded, useful observation in the model transcript.
 */
export function buildBoundedToolObservation(
  observation: Record<string, unknown>,
  maxChars = TOOL_RESULT_INLINE_MAX_CHARS
): string {
  const data = readRecord(observation['data'])
  const output = readRecord(data?.['output'])
  const page = readRecord(output?.['result'])

  // Complete projections need one lossless representation in the model context.
  // Keep both forms when serialization differs, including unsafe JSON numbers.
  if (
    data && output && page &&
    typeof readRecord(page['execution'])?.['id'] === 'string' &&
    typeof page['content'] === 'string' && page['truncated'] === false &&
    page['content'].trim() === JSON.stringify(page['value'])
  ) {
    const projectedPage = { ...page }
    delete projectedPage['content']
    observation = {
      ...observation,
      data: { ...data, output: { ...output, result: projectedPage } }
    }
  }

  const serialized = JSON.stringify(observation)
  if (serialized.length <= maxChars) {
    return serialized
  }

  const outputLogPath = observation['output_log_path']
  const retainedExecution = readRecord(observation['execution']) ||
    readRecord(readRecord(readRecord(observation['data'])?.['output'])?.['execution'])
  const execution = typeof retainedExecution?.['id'] === 'string'
    ? { id: retainedExecution['id'], state: retainedExecution['state'] }
    : null
  const previewMaxChars = Math.max(Math.floor(maxChars * 0.7), 1)
  const compacted = {
    status: observation['status'],
    ...(observation['raw_status'] !== undefined
      ? { raw_status: observation['raw_status'] }
      : {}),
    message: observation['message'],
    ...(execution ? {
      execution,
      result_note: 'Query the full retained JSON with system_utilities.tool_executions.read using execution.id and options.jq. Do not parse diagnostic logs or rerun completed work.'
    } : {}),
    ...(typeof outputLogPath === 'string' && outputLogPath
      ? {
          output_log_path: outputLogPath,
          artifact_note: execution
            ? 'output_log_path is a diagnostic log; use the retained execution to query structured output.'
            : 'The complete tool result is stored at output_log_path. Read only the needed section if the preview is insufficient.'
        }
      : {}),
    data_preview: createAgentTextPreview(
      JSON.stringify(observation['data'] ?? null),
      execution
        ? Math.min(previewMaxChars, RETAINED_RESULT_PREVIEW_MAX_CHARS)
        : previewMaxChars
    ),
    ...(observation['observed_tool_failure'] !== undefined
      ? { observed_tool_failure: observation['observed_tool_failure'] }
      : {}),
    observation_compacted: true
  }

  return JSON.stringify(compacted)
}

/**
 * Finds whole tool exchanges that can be retained or projected together.
 */
export function findCompletedToolExchanges(
  transcript: AgentToolTranscriptMessage[]
): CompletedToolExchange[] {
  const exchanges: CompletedToolExchange[] = []

  for (let index = 0; index < transcript.length; index += 1) {
    const message = transcript[index]
    if (
      message?.role !== 'assistant' ||
      !message.toolCalls ||
      message.toolCalls.length === 0
    ) {
      continue
    }

    const toolMessages: ToolTranscriptMessage[] = []
    let endIndex = index
    while (transcript[endIndex + 1]?.role === 'tool') {
      toolMessages.push(transcript[endIndex + 1] as ToolTranscriptMessage)
      endIndex += 1
    }

    const completedToolCallIds = new Set(
      toolMessages.map((toolMessage) => toolMessage.toolCallId)
    )
    if (
      message.toolCalls.every((toolCall) =>
        completedToolCallIds.has(toolCall.id)
      )
    ) {
      exchanges.push({
        startIndex: index,
        endIndex,
        assistantMessage: message as AssistantToolCallMessage,
        toolMessages
      })
      index = endIndex
    }
  }

  return exchanges
}

/**
 * Limits replay of archived results at a completed turn or after a substantial
 * batch of older evidence has accrued. Keep recent exchanges and source handles.
 */
export function projectSettledAgentEvidence(
  transcript: AgentToolTranscriptMessage[],
  atTurnBoundary = false
): AgentToolTranscriptMessage[] {
  const recentExchanges = atTurnBoundary ? 1 : SUMMARY_RECENT_EXCHANGES
  const exchanges = findCompletedToolExchanges(transcript).slice(0, -recentExchanges)
  const replacements = new Map<ToolTranscriptMessage, ToolTranscriptMessage>()
  let savedChars = 0

  for (const exchange of exchanges) {
    for (const message of exchange.toolMessages) {
      if (message.files?.length || typeof message.content !== 'string' ||
        message.content.length <= RETAINED_RESULT_PREVIEW_MAX_CHARS) {
        continue
      }

      let observation: Record<string, unknown> | null
      try {
        observation = readRecord(JSON.parse(message.content))
      } catch {
        continue
      }
      if (!observation || observation['status'] !== 'success' ||
        observation['observation_compacted'] || observation['observed_tool_failure'] ||
        (typeof observation['output_log_path'] !== 'string' &&
          typeof readRecord(observation['execution'])?.['id'] !== 'string')) {
        continue
      }

      const content = buildBoundedToolObservation(observation, RETAINED_RESULT_PREVIEW_MAX_CHARS)
      replacements.set(message, { ...message, content })
      savedChars += message.content.length - content.length
    }
  }

  // Preserve the reusable prefix between batches. The projected view is used
  // as the canonical transcript after a checkpoint so it never shrinks twice.
  if (savedChars <= 0 || (!atTurnBoundary && savedChars < TOOL_RESULT_INLINE_MAX_CHARS)) {
    return transcript
  }

  return transcript.map((message) =>
    message.role === 'tool' ? replacements.get(message) ?? message : message
  )
}

/**
 * Selects an older prefix without splitting parallel tool calls from results.
 * Requiring another tail's worth of work avoids re-summarizing every turn.
 */
export function splitAgentTranscriptForSummary(
  transcript: AgentToolTranscriptMessage[],
  forceCompaction = false,
  recentExchangeLimit = SUMMARY_RECENT_EXCHANGES
): {
  older: AgentToolTranscriptMessage[]
  visual: AgentToolTranscriptMessage[]
  recent: AgentToolTranscriptMessage[]
} | null {
  const exchanges = findCompletedToolExchanges(transcript)
  // Inspection pages can produce many findings from one tool exchange. They
  // are safe summary boundaries too, after all matching tool results settled.
  const boundaries = [...new Set([
    ...exchanges.map((exchange) => exchange.startIndex),
    ...transcript.flatMap((message, index) =>
      message.role === 'user' && message.runtimeContext?.['visualInspectionBatch']
        ? [index]
        : []
    )
  ])].sort((left, right) => left - right)
  // Recovery can reduce even short histories while preserving complete exchanges.
  const recentExchanges = forceCompaction
    ? Math.min(recentExchangeLimit, Math.floor(boundaries.length / 2))
    : SUMMARY_RECENT_EXCHANGES
  if (boundaries.length === 0 || boundaries.length < recentExchanges * 2) {
    return null
  }

  // The continuation retains the latest owner message separately. Anchoring the
  // tail to that message would retain all subsequent work in a long task.
  // The last completed exchange may exceed the budget on its own. Its saved
  // result can replace it, but unfinished calls must remain in the raw tail.
  const boundary = recentExchanges > 0
    ? boundaries[boundaries.length - recentExchanges]!
    : Math.max(
        exchanges.at(-1)?.endIndex ?? -1,
        boundaries.at(-1)!
      ) + 1
  if (boundary <= 0) {
    return null
  }

  // Keep a bounded visual reference even when the recent tail is text-only.
  // Retain whole exchanges so parallel tool results never become orphaned.
  const boundedTranscript = retainRecentToolImages(transcript)
  const visual = findCompletedToolExchanges(boundedTranscript)
    .filter((exchange) =>
      exchange.endIndex < boundary && exchange.toolMessages.some((message) =>
        message.files?.some((file) => file.mediaType.startsWith('image/'))
      )
    )
    .flatMap((exchange) =>
      boundedTranscript.slice(exchange.startIndex, exchange.endIndex + 1)
    )

  return {
    older: boundedTranscript.slice(0, boundary),
    visual,
    recent: boundedTranscript.slice(boundary)
  }
}

function getToolkitIdFromFunctionName(functionName: string): string | null {
  const separatorIndex = functionName.indexOf(TOOL_NAME_SEPARATOR)
  return separatorIndex > 0 ? functionName.slice(0, separatorIndex) : null
}

function getLoadedToolkitId(toolCallArguments: string): string | null {
  try {
    const parsed = readRecord(JSON.parse(toolCallArguments))
    const toolkitId = parsed?.['toolkit_id']
    return typeof toolkitId === 'string' && toolkitId.trim()
      ? toolkitId.trim()
      : null
  } catch {
    return null
  }
}

function findRecentToolkitIds(
  transcript: AgentToolTranscriptMessage[]
): Set<string> {
  const toolkitIds = new Set<string>()

  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const message = transcript[index]
    if (message?.role !== 'assistant' || !message.toolCalls) {
      continue
    }

    for (let callIndex = message.toolCalls.length - 1; callIndex >= 0; callIndex -= 1) {
      const toolCall = message.toolCalls[callIndex]!
      const toolkitId =
        getToolkitIdFromFunctionName(toolCall.function.name) ||
        (toolCall.function.name === AGENT_TOOLKIT_LOADER_NAME
          ? getLoadedToolkitId(toolCall.function.arguments)
          : null)

      if (toolkitId) {
        toolkitIds.add(toolkitId)
      }
      if (toolkitIds.size >= AGENT_RECENT_TOOLKIT_SCHEMA_LIMIT) {
        return toolkitIds
      }
    }
  }

  return toolkitIds
}

/**
 * References identical tool-owned context only when its latest full version is
 * still in this request. Rebuilding from raw history restores it after compaction
 * without sharing state across conversations or changing saved evidence.
 */
export function reuseToolContext(
  transcript: AgentToolTranscriptMessage[]
): AgentToolTranscriptMessage[] {
  let visible = new Map<string, { content: string, callId: string }>()

  return transcript.map((message) => {
    if (message.role !== 'tool' || !message.content.includes('"modelContextId"')) {
      return message
    }

    let changed = false
    const nextVisible = new Map(visible)
    const project = (value: unknown): unknown => {
      if (Array.isArray(value)) {
        return value.map(project)
      }

      const record = readRecord(value)
      if (!record) {
        return value
      }

      const { content, ...metadata } = record
      if (typeof record['modelContextId'] === 'string' && typeof content === 'string') {
        const key = JSON.stringify([message.toolName, record['modelContextId']])
        const previous = nextVisible.get(key)
        const projectedMetadata = Object.fromEntries(Object.entries(metadata).map(([key, child]) =>
          [key, project(child)]
        ))

        if (previous?.content === content) {
          changed = true
          return {
            ...projectedMetadata,
            contentReference: `Unchanged context; complete content is in tool call ${previous.callId}.`
          }
        }

        nextVisible.set(key, {
          content,
          callId: message.toolCallId
        })
        return { ...projectedMetadata, content }
      }

      return Object.fromEntries(Object.entries(record).map(([key, child]) =>
        [key, project(child)]
      ))
    }

    try {
      const observation = readRecord(JSON.parse(message.content))
      const data = readRecord(observation?.['data'])
      const output = readRecord(data?.['output'])

      if (!observation || !data || !output) {
        return message
      }

      // Only tool-owned output opts in. Echoed model arguments are not context.
      const projectedOutput = project(output)
      const projected = changed
        ? { ...message, content: JSON.stringify({
            ...observation,
            data: { ...data, output: projectedOutput }
          }) }
        : message
      visible = nextVisible
      return projected
    } catch {
      // Plain text and incomplete observations remain available verbatim.
      return message
    }
  })
}

function pruneInactiveToolkitSchemas(
  transcript: AgentToolTranscriptMessage[],
  tools: OpenAITool[]
): OpenAITool[] {
  const hasToolkitLoader = tools.some(
    (tool) => tool.function.name === AGENT_TOOLKIT_LOADER_NAME
  )
  if (!hasToolkitLoader) {
    // Forced-tool runs cannot reload a schema, so they must retain it.
    return tools
  }

  const recentToolkitIds = findRecentToolkitIds(transcript)
  return tools.filter((tool) => {
    const toolkitId = getToolkitIdFromFunctionName(tool.function.name)
    return !toolkitId || recentToolkitIds.has(toolkitId)
  })
}

/**
 * Prepares a bounded view of the continuous transcript without another model
 * call. Short prompts are returned unchanged, keeping the normal path fast.
 */
export function prepareAgentModelContext(
  params: AgentModelContextParams
): PreparedAgentModelContext {
  return runTurnPhase(TurnPhase.Context, () => prepareModelContext(params))
}

function prepareModelContext(
  params: AgentModelContextParams
): PreparedAgentModelContext {
  const imageBoundedTranscript = retainRecentToolImages(
    params.transcript
  )
  const reusedTranscript = reuseToolContext(imageBoundedTranscript)
  const estimatedInputTokensBeforePreparation = estimateAgentInputTokens(
    reusedTranscript,
    params.systemPrompt,
    params.tools
  )
  // Keep reusable text unchanged until context pressure requires reduction.
  // Aging alone must not rewrite the prefix on every successive request.
  const shouldReduceContext = params.forceCompaction ||
    estimatedInputTokensBeforePreparation > params.compactionTriggerTokens
  // Reduction may remove a context source. Resolve references from the final
  // view so every reference still has its complete content in this request.
  const reducedTranscript = shouldReduceContext
    ? boundOlderUIObservations(imageBoundedTranscript)
    : imageBoundedTranscript
  const boundedTranscript = shouldReduceContext
    ? reuseToolContext(reducedTranscript)
    : reusedTranscript
  // Only discard reloadable schemas here. The continuity summary owns text
  // reduction, so its trigger sees the real cost of the original evidence.
  const tools = !params.preserveToolSchemas && shouldReduceContext
    ? pruneInactiveToolkitSchemas(imageBoundedTranscript, params.tools)
    : params.tools
  const contextTokenBreakdown = estimateContextTokens(boundedTranscript, params.systemPrompt, tools)
  return {
    transcript: boundedTranscript,
    tools,
    estimatedInputTokensBeforePreparation,
    estimatedInputTokens: sumContextTokens(contextTokenBreakdown),
    contextTokenBreakdown,
    wasCompacted: tools.length < params.tools.length || reducedTranscript.some(
      (message, index) => message !== imageBoundedTranscript[index]
    )
  }
}
