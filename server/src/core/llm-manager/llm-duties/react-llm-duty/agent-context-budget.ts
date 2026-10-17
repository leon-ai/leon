import type {
  AgentToolTranscriptMessage,
  OpenAITool,
  OpenAIToolCall
} from '@/core/llm-manager/types'
import { LLMProviders } from '@/core/llm-manager/types'
import { TOOL_RESULT_INLINE_MAX_CHARS } from '@/constants'
import {
  LOCAL_LLM_CONTEXT_WINDOW_TOKENS,
  isLocalLLMProvider
} from '@/core/llm-manager/model-context-windows'

import {
  AGENT_CONTEXT_WINDOW_BUDGET_RATIO,
  AGENT_CONTEXT_RECOVERY_BUDGET_RATIO,
  AGENT_LOCAL_CONTEXT_SAFETY_MARGIN_RATIO,
  AGENT_RECENT_TOOLKIT_SCHEMA_LIMIT,
  AGENT_RECENT_TOOL_IMAGE_LIMIT,
  AGENT_MODEL_IMAGE_ESTIMATED_TOKENS,
  AGENT_REMOTE_CONTEXT_COMPACTION_TRIGGER_TOKENS,
  AGENT_REMOTE_CONTEXT_RECOVERY_TRIGGER_TOKENS,
  CHARS_PER_TOKEN
} from './agent-constants'

const TOOL_NAME_SEPARATOR = '__'
const UI_TOOLKIT_IDS = ['computer_use', 'browser_use'] as const
const TOOLKIT_LOADER_NAME = 'load_toolkit'
const SUMMARY_RECENT_EXCHANGES = 8
const OLDER_UI_OBSERVATION_MAX_CHARS = 1_500
const RETAINED_RESULT_PREVIEW_MAX_CHARS = 4_096

interface AgentModelContextParams {
  transcript: AgentToolTranscriptMessage[]
  systemPrompt: string
  tools: OpenAITool[]
  compactionTriggerTokens: number
  forceCompaction?: boolean
}

export interface PreparedAgentModelContext {
  transcript: AgentToolTranscriptMessage[]
  tools: OpenAITool[]
  estimatedInputTokensBeforePreparation: number
  estimatedInputTokens: number
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
 * Resolves when deterministic context compaction should begin. Local models
 * follow their configured window while remote providers share a stable trigger.
 */
export function resolveAgentContextCompactionTriggerTokens(
  provider: LLMProviders
): number {
  if (!isLocalLLMProvider(provider)) {
    return AGENT_REMOTE_CONTEXT_COMPACTION_TRIGGER_TOKENS
  }

  return Math.floor(
    LOCAL_LLM_CONTEXT_WINDOW_TOKENS * AGENT_CONTEXT_WINDOW_BUDGET_RATIO
  )
}

/**
 * Returns the smaller target used for one provider context-pressure retry.
 */
export function resolveAgentContextRecoveryTriggerTokens(
  provider: LLMProviders
): number {
  if (!isLocalLLMProvider(provider)) {
    return AGENT_REMOTE_CONTEXT_RECOVERY_TRIGGER_TOKENS
  }

  return Math.floor(
    LOCAL_LLM_CONTEXT_WINDOW_TOKENS * AGENT_CONTEXT_RECOVERY_BUDGET_RATIO
  )
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
function estimateAgentInputTokens(
  transcript: AgentToolTranscriptMessage[],
  systemPrompt: string,
  tools: OpenAITool[]
): number {
  let imageCount = 0
  let compactionTokens = 0
  const serializedTranscript = JSON.stringify(transcript, (key, value) => {
    if (key === 'runtimeContext') {
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

  return (
    estimateTokens(serializedTranscript) +
    compactionTokens +
    imageCount * AGENT_MODEL_IMAGE_ESTIMATED_TOKENS +
    estimateTokens(systemPrompt) +
    estimateTokens(JSON.stringify(tools))
  )
}

/**
 * Keeps recent tool images and the latest inspection batch without changing
 * saved evidence, textual results, or owner attachments.
 */
export function retainRecentToolImages(
  transcript: AgentToolTranscriptMessage[]
): AgentToolTranscriptMessage[] {
  const retainedImageIndexes = new Set<number>()
  for (
    let index = transcript.length - 1;
    index >= 0 && retainedImageIndexes.size < AGENT_RECENT_TOOL_IMAGE_LIMIT;
    index -= 1
  ) {
    const message = transcript[index]
    if (
      message?.role === 'tool' &&
      message.files?.some((file) => file.mediaType.startsWith('image/'))
    ) {
      retainedImageIndexes.add(index)
    }
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

  return transcript.map((message, index) => {
    if (
      message.role !== 'tool' ||
      !message.files?.some((file) => file.mediaType.startsWith('image/')) ||
      retainedImageIndexes.has(index)
    ) {
      return message
    }

    const { files, ...textMessage } = message
    const retainedFiles = files.filter((file) =>
      !file.mediaType.startsWith('image/')
    )

    return retainedFiles.length > 0
      ? { ...textMessage, files: retainedFiles }
      : textMessage
  })
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

function findCompletedToolExchanges(
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
 * Selects an older prefix without splitting parallel tool calls from results.
 * Requiring another tail's worth of work avoids re-summarizing every turn.
 */
export function splitAgentTranscriptForSummary(
  transcript: AgentToolTranscriptMessage[]
): {
  older: AgentToolTranscriptMessage[]
  visual: AgentToolTranscriptMessage[]
  recent: AgentToolTranscriptMessage[]
} | null {
  const exchanges = findCompletedToolExchanges(transcript)
  if (exchanges.length < SUMMARY_RECENT_EXCHANGES * 2) return null

  let boundary = exchanges[exchanges.length - SUMMARY_RECENT_EXCHANGES]!.startIndex
  // Keep the latest user correction verbatim, even if that enlarges the tail.
  const lastUserIndex = transcript.findLastIndex((message) =>
    message.role === 'user' && !message.runtimeContext
  )
  if (lastUserIndex > exchanges[0]!.startIndex) {
    boundary = Math.min(boundary, lastUserIndex)
  }
  if (boundary <= 0) return null

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
        (toolCall.function.name === TOOLKIT_LOADER_NAME
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

function pruneInactiveToolkitSchemas(
  transcript: AgentToolTranscriptMessage[],
  tools: OpenAITool[]
): OpenAITool[] {
  const hasToolkitLoader = tools.some(
    (tool) => tool.function.name === TOOLKIT_LOADER_NAME
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
  const imageBoundedTranscript = retainRecentToolImages(
    params.transcript
  )
  const estimatedInputTokensBeforePreparation = estimateAgentInputTokens(
    imageBoundedTranscript,
    params.systemPrompt,
    params.tools
  )
  const boundedTranscript = boundOlderUIObservations(imageBoundedTranscript)
  // Only discard reloadable schemas here. The continuity summary owns text
  // reduction, so its trigger sees the real cost of the original evidence.
  const tools = params.forceCompaction ||
    estimatedInputTokensBeforePreparation > params.compactionTriggerTokens
    ? pruneInactiveToolkitSchemas(imageBoundedTranscript, params.tools)
    : params.tools
  return {
    transcript: boundedTranscript,
    tools,
    estimatedInputTokensBeforePreparation,
    estimatedInputTokens: estimateAgentInputTokens(
      boundedTranscript, params.systemPrompt, tools
    ),
    wasCompacted: tools.length < params.tools.length || boundedTranscript.some(
      (message, index) => message !== imageBoundedTranscript[index]
    )
  }
}
