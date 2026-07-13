import type {
  AgentToolTranscriptMessage,
  OpenAITool,
  OpenAIToolCall
} from '@/core/llm-manager/types'
import { LLMProviders } from '@/core/llm-manager/types'
import {
  LOCAL_LLM_CONTEXT_WINDOW_TOKENS,
  isLocalLLMProvider
} from '@/core/llm-manager/model-context-windows'

import {
  AGENT_CONTEXT_WINDOW_BUDGET_RATIO,
  AGENT_CONTEXT_RECOVERY_BUDGET_RATIO,
  AGENT_LOCAL_CONTEXT_SAFETY_MARGIN_RATIO,
  AGENT_COMPACTED_TOOL_EXCHANGE_FIELD_MAX_CHARS,
  AGENT_COMPACTED_TOOL_EXCHANGE_MAX_CHARS,
  AGENT_COMPACTED_TOOL_HISTORY_MAX_CHARS,
  AGENT_COMPACTED_TOOL_MESSAGE_MAX_CHARS,
  AGENT_RECENT_TOOL_EXCHANGE_LIMIT,
  AGENT_RECENT_TOOLKIT_SCHEMA_LIMIT,
  AGENT_REMOTE_CONTEXT_COMPACTION_TRIGGER_TOKENS,
  AGENT_REMOTE_CONTEXT_RECOVERY_TRIGGER_TOKENS,
  AGENT_TOOL_OBSERVATION_MAX_CHARS,
  CHARS_PER_TOKEN
} from './constants'

const TOOL_NAME_SEPARATOR = '__'
const TOOLKIT_LOADER_NAME = 'load_toolkit'

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
  estimatedInputTokens: number
  wasCompacted: boolean
  compactedToolExchangeCount: number
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

/** Returns the smaller target used for one provider context-pressure retry. */
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
 * a tokenizer-estimation margin. Remote providers manage their own ceiling.
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

function estimateAgentInputTokens(
  transcript: AgentToolTranscriptMessage[],
  systemPrompt: string,
  tools: OpenAITool[]
): number {
  return (
    estimateTokens(JSON.stringify(transcript)) +
    estimateTokens(systemPrompt) +
    estimateTokens(JSON.stringify(tools))
  )
}

function createTextPreview(value: string, maxChars: number): string {
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
  maxChars = AGENT_TOOL_OBSERVATION_MAX_CHARS
): string {
  const serialized = JSON.stringify(observation)
  if (serialized.length <= maxChars) {
    return serialized
  }

  const outputLogPath = observation['output_log_path']
  const compacted = {
    status: observation['status'],
    ...(observation['raw_status'] !== undefined
      ? { raw_status: observation['raw_status'] }
      : {}),
    message: observation['message'],
    ...(typeof outputLogPath === 'string' && outputLogPath
      ? {
          output_log_path: outputLogPath,
          artifact_note:
            'The complete tool result is stored at output_log_path. Read only the needed section if the preview is insufficient.'
        }
      : {}),
    data_preview: createTextPreview(
      JSON.stringify(observation['data'] ?? null),
      Math.max(Math.floor(maxChars * 0.7), 1)
    ),
    ...(observation['observed_tool_failure'] !== undefined
      ? { observed_tool_failure: observation['observed_tool_failure'] }
      : {}),
    observation_compacted: true
  }

  return JSON.stringify(compacted)
}

function compactToolMessageContent(content: string): string {
  if (content.length <= AGENT_COMPACTED_TOOL_MESSAGE_MAX_CHARS) {
    return content
  }

  try {
    const parsed = readRecord(JSON.parse(content))
    if (parsed) {
      const outputLogPath = parsed['output_log_path']
      return JSON.stringify({
        status: parsed['status'],
        message: parsed['message'],
        ...(typeof outputLogPath === 'string' && outputLogPath
          ? { output_log_path: outputLogPath }
          : {}),
        ...(parsed['observed_tool_failure'] !== undefined
          ? { observed_tool_failure: parsed['observed_tool_failure'] }
          : {}),
        context_compacted: true,
        preview: createTextPreview(
          content,
          AGENT_COMPACTED_TOOL_MESSAGE_MAX_CHARS
        )
      })
    }
  } catch {
    // Non-JSON control-tool results, including Agent Skills, use a bounded
    // head/tail preview and can be explicitly loaded again when needed.
  }

  return createTextPreview(content, AGENT_COMPACTED_TOOL_MESSAGE_MAX_CHARS)
}

function createBoundedExchangeField(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  const serialized =
    typeof value === 'string' ? value : JSON.stringify(value)
  return createTextPreview(
    serialized,
    AGENT_COMPACTED_TOOL_EXCHANGE_FIELD_MAX_CHARS
  )
}

function buildCompactedToolResult(message: ToolTranscriptMessage): Record<string, unknown> {
  try {
    const parsed = readRecord(JSON.parse(message.content))
    if (parsed) {
      const details =
        parsed['data_preview'] ?? parsed['preview'] ?? parsed['data']
      return {
        tool: message.toolName,
        ...(parsed['status'] !== undefined
          ? { status: parsed['status'] }
          : {}),
        ...(parsed['message'] !== undefined
          ? { message: createBoundedExchangeField(parsed['message']) }
          : {}),
        ...(parsed['output_log_path'] !== undefined
          ? { output_log_path: parsed['output_log_path'] }
          : {}),
        ...(parsed['observed_tool_failure'] !== undefined
          ? {
              observed_tool_failure: createBoundedExchangeField(
                parsed['observed_tool_failure']
              )
            }
          : {}),
        ...(details !== undefined
          ? { details: createBoundedExchangeField(details) }
          : {})
      }
    }
  } catch {
    // Plain-text control and skill results are preserved as bounded details.
  }

  return {
    tool: message.toolName,
    details: createBoundedExchangeField(message.content)
  }
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

function buildCompactedToolExchangeMessage(
  exchange: CompletedToolExchange
): AgentToolTranscriptMessage {
  const toolMessagesById = new Map(
    exchange.toolMessages.map((message) => [message.toolCallId, message])
  )
  const calls = exchange.assistantMessage.toolCalls.map((toolCall) => {
    const result = toolMessagesById.get(toolCall.id)
    return {
      tool: toolCall.function.name,
      arguments: createBoundedExchangeField(toolCall.function.arguments),
      ...(result ? { result: buildCompactedToolResult(result) } : {})
    }
  })
  const assistantNote = exchange.assistantMessage.content.trim()
  const compactedExchange = {
    earlier_completed_tool_exchange_compacted: true,
    ...(assistantNote
      ? { assistant_note: createBoundedExchangeField(assistantNote) }
      : {}),
    calls
  }
  const serializedExchange = JSON.stringify(compactedExchange)

  if (serializedExchange.length <= AGENT_COMPACTED_TOOL_EXCHANGE_MAX_CHARS) {
    return {
      role: 'assistant',
      content: serializedExchange
    }
  }

  const tools = [...new Set(calls.map((call) => call.tool))]
  const artifactPaths = [
    ...new Set(
      calls.flatMap((call) => {
        const outputLogPath = call.result?.['output_log_path']
        return typeof outputLogPath === 'string' ? [outputLogPath] : []
      })
    )
  ]
  const failedTools = [
    ...new Set(
      calls.flatMap((call) => {
        const status = call.result?.['status']
        const observedFailure = call.result?.['observed_tool_failure']
        return (typeof status === 'string' && status !== 'success') ||
          observedFailure !== undefined
          ? [call.tool]
          : []
      })
    )
  ]
  const summary = {
    earlier_completed_tool_exchange_compacted: true,
    tools,
    ...(artifactPaths.length > 0 ? { artifact_paths: artifactPaths } : {}),
    ...(failedTools.length > 0 ? { failed_tools: failedTools } : {}),
    preview: serializedExchange
  }
  let serializedSummary = JSON.stringify(summary)
  const overflowChars = Math.max(
    serializedSummary.length - AGENT_COMPACTED_TOOL_EXCHANGE_MAX_CHARS,
    0
  )
  if (overflowChars > 0) {
    summary.preview = createTextPreview(
      serializedExchange,
      Math.max(serializedExchange.length - overflowChars, 1)
    )
    serializedSummary = JSON.stringify(summary)
  }
  if (serializedSummary.length > AGENT_COMPACTED_TOOL_EXCHANGE_MAX_CHARS) {
    const remainingOverflow =
      serializedSummary.length - AGENT_COMPACTED_TOOL_EXCHANGE_MAX_CHARS
    summary.preview = summary.preview.slice(
      0,
      Math.max(summary.preview.length - remainingOverflow, 0)
    )
    serializedSummary = JSON.stringify(summary)
  }

  return {
    role: 'assistant',
    content: serializedSummary
  }
}

function compactOldestCompletedToolExchange(
  transcript: AgentToolTranscriptMessage[],
  recentExchangeLimit = AGENT_RECENT_TOOL_EXCHANGE_LIMIT
): AgentToolTranscriptMessage[] | null {
  const exchanges = findCompletedToolExchanges(transcript)
  if (exchanges.length <= recentExchangeLimit) {
    return null
  }

  const exchange = exchanges[0]!
  return [
    ...transcript.slice(0, exchange.startIndex),
    buildCompactedToolExchangeMessage(exchange),
    ...transcript.slice(exchange.endIndex + 1)
  ]
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function readCompactedExchangeMetadata(content: string): {
  tools: string[]
  artifactPaths: string[]
  failedTools: string[]
} | null {
  try {
    const parsed = readRecord(JSON.parse(content))
    if (!parsed?.['earlier_completed_tool_exchange_compacted']) {
      return null
    }

    const calls = Array.isArray(parsed['calls'])
      ? parsed['calls'].flatMap((value) => {
          const call = readRecord(value)
          return call ? [call] : []
        })
      : []
    return {
      tools: [
        ...readStringArray(parsed['tools']),
        ...calls.flatMap((call) =>
          typeof call['tool'] === 'string' ? [call['tool']] : []
        )
      ],
      artifactPaths: [
        ...readStringArray(parsed['artifact_paths']),
        ...calls.flatMap((call) => {
          const result = readRecord(call['result'])
          const outputLogPath = result?.['output_log_path']
          return typeof outputLogPath === 'string' ? [outputLogPath] : []
        })
      ],
      failedTools: [
        ...readStringArray(parsed['failed_tools']),
        ...calls.flatMap((call) => {
          const result = readRecord(call['result'])
          const status = result?.['status']
          return ((typeof status === 'string' && status !== 'success') ||
            result?.['observed_tool_failure'] !== undefined) &&
            typeof call['tool'] === 'string'
            ? [call['tool']]
            : []
        })
      ]
    }
  } catch {
    return null
  }
}

function mergeCompactedToolExchangeHistory(
  transcript: AgentToolTranscriptMessage[],
  maxChars: number
): AgentToolTranscriptMessage[] | null {
  const compactedIndexes: number[] = []
  const metadata: Array<NonNullable<ReturnType<typeof readCompactedExchangeMetadata>>> = []

  for (const [index, message] of transcript.entries()) {
    if (message.role !== 'assistant') {
      continue
    }

    const exchangeMetadata = readCompactedExchangeMetadata(message.content)
    if (exchangeMetadata) {
      compactedIndexes.push(index)
      metadata.push(exchangeMetadata)
    }
  }

  if (compactedIndexes.length <= 1) {
    return null
  }

  const tools = [...new Set(metadata.flatMap((item) => item.tools))]
  const artifactPaths = [
    ...new Set(metadata.flatMap((item) => item.artifactPaths))
  ]
  const failedTools = [
    ...new Set(metadata.flatMap((item) => item.failedTools))
  ]
  const combinedContent = compactedIndexes
    .map((index) => (transcript[index] as { content: string }).content)
    .join('\n')
  const merged = {
    earlier_completed_tool_exchange_compacted: true,
    merged_exchange_count: compactedIndexes.length,
    tools,
    ...(artifactPaths.length > 0 ? { artifact_paths: artifactPaths } : {}),
    ...(failedTools.length > 0 ? { failed_tools: failedTools } : {}),
    preview: combinedContent
  }
  let serializedMerged = JSON.stringify(merged)
  if (serializedMerged.length > maxChars) {
    const overflow = serializedMerged.length - maxChars
    merged.preview = createTextPreview(
      combinedContent,
      Math.max(combinedContent.length - overflow, 1)
    )
    serializedMerged = JSON.stringify(merged)
  }
  if (serializedMerged.length > maxChars) {
    const remainingOverflow = serializedMerged.length - maxChars
    merged.preview = merged.preview.slice(
      0,
      Math.max(merged.preview.length - remainingOverflow, 0)
    )
    serializedMerged = JSON.stringify(merged)
  }

  const compactedIndexSet = new Set(compactedIndexes)
  const firstCompactedIndex = compactedIndexes[0]!
  return transcript.flatMap((message, index) => {
    if (index === firstCompactedIndex) {
      return [{ role: 'assistant' as const, content: serializedMerged }]
    }
    return compactedIndexSet.has(index) ? [] : [message]
  })
}

function resolveMergedToolHistoryMaxChars(
  transcript: AgentToolTranscriptMessage[],
  estimatedInputTokens: number,
  compactionTriggerTokens: number
): number {
  const compactedContentChars = transcript.reduce((total, message) => {
    return message.role === 'assistant' &&
      readCompactedExchangeMetadata(message.content)
      ? total + message.content.length
      : total
  }, 0)
  const estimatedOverflowChars = Math.max(
    (estimatedInputTokens - compactionTriggerTokens) * CHARS_PER_TOKEN,
    0
  )

  return Math.max(
    Math.min(
      AGENT_COMPACTED_TOOL_HISTORY_MAX_CHARS,
      compactedContentChars - estimatedOverflowChars
    ),
    1
  )
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
  const initialEstimate = estimateAgentInputTokens(
    params.transcript,
    params.systemPrompt,
    params.tools
  )
  if (
    !params.forceCompaction &&
    initialEstimate <= params.compactionTriggerTokens
  ) {
    return {
      transcript: params.transcript,
      tools: params.tools,
      estimatedInputTokens: initialEstimate,
      wasCompacted: false,
      compactedToolExchangeCount: 0
    }
  }

  const tools = pruneInactiveToolkitSchemas(params.transcript, params.tools)
  let transcript = params.transcript.map((message) =>
    message.role === 'tool'
      ? {
          ...message,
          content: compactToolMessageContent(message.content)
        }
      : message
  )
  let estimatedInputTokens = estimateAgentInputTokens(
    transcript,
    params.systemPrompt,
    tools
  )
  let compactedToolExchangeCount = 0
  let recentExchangeLimit = AGENT_RECENT_TOOL_EXCHANGE_LIMIT

  // Remove complete protocol pairs together, oldest first, until the prompt is
  // safely below its trigger. Recent exchanges are preferred, but a large
  // parallel batch must not make the context target impossible to satisfy.
  while (estimatedInputTokens > params.compactionTriggerTokens) {
    const compactedTranscript = compactOldestCompletedToolExchange(
      transcript,
      recentExchangeLimit
    )
    if (compactedTranscript) {
      transcript = compactedTranscript
      compactedToolExchangeCount += 1
      estimatedInputTokens = estimateAgentInputTokens(
        transcript,
        params.systemPrompt,
        tools
      )
      continue
    }

    const mergedTranscript = mergeCompactedToolExchangeHistory(
      transcript,
      resolveMergedToolHistoryMaxChars(
        transcript,
        estimatedInputTokens,
        params.compactionTriggerTokens
      )
    )
    if (!mergedTranscript) {
      if (recentExchangeLimit > 0) {
        recentExchangeLimit = 0
        continue
      }
      break
    }

    transcript = mergedTranscript
    estimatedInputTokens = estimateAgentInputTokens(
      transcript,
      params.systemPrompt,
      tools
    )
  }

  const mergedTranscript = mergeCompactedToolExchangeHistory(
    transcript,
    resolveMergedToolHistoryMaxChars(
      transcript,
      estimatedInputTokens,
      params.compactionTriggerTokens
    )
  )
  if (mergedTranscript) {
    transcript = mergedTranscript
    estimatedInputTokens = estimateAgentInputTokens(
      transcript,
      params.systemPrompt,
      tools
    )
  }

  return {
    transcript,
    tools,
    estimatedInputTokens,
    wasCompacted: true,
    compactedToolExchangeCount
  }
}
