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
  AGENT_RECENT_TOOLKIT_SCHEMA_LIMIT,
  AGENT_RECENT_COMPUTER_USE_IMAGE_LIMIT,
  AGENT_MODEL_IMAGE_ESTIMATED_TOKENS,
  AGENT_REMOTE_CONTEXT_COMPACTION_TRIGGER_TOKENS,
  AGENT_REMOTE_CONTEXT_RECOVERY_TRIGGER_TOKENS,
  AGENT_TOOL_OBSERVATION_MAX_CHARS,
  AGENT_OUTPUT_RECOVERY_MAX_TOKENS,
  CHARS_PER_TOKEN
} from './constants'

const TOOL_NAME_SEPARATOR = '__'
const TOOLKIT_LOADER_NAME = 'load_toolkit'
const SUMMARY_RECENT_EXCHANGES = 8

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
 * a tokenizer-estimation margin. Remote calls keep the provider layer's default
 * unless retrying output exhaustion with a bounded larger allowance.
 */
export function resolveAgentMaxOutputTokens(
  provider: LLMProviders,
  estimatedInputTokens: number,
  isOutputRecoveryAttempt = false
): number | undefined {
  if (!isLocalLLMProvider(provider)) {
    return isOutputRecoveryAttempt ? AGENT_OUTPUT_RECOVERY_MAX_TOKENS : undefined
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

/** Estimates the complete request, excluding encoded image bytes. */
function estimateAgentInputTokens(
  transcript: AgentToolTranscriptMessage[],
  systemPrompt: string,
  tools: OpenAITool[]
): number {
  let imageCount = 0
  const serializedTranscript = JSON.stringify(transcript, (key, value) => {
    if (key === 'dataBase64' && typeof value === 'string') {
      imageCount += 1
      return ''
    }
    return value
  })

  return (
    estimateTokens(serializedTranscript) +
    imageCount * AGENT_MODEL_IMAGE_ESTIMATED_TOKENS +
    estimateTokens(systemPrompt) +
    estimateTokens(JSON.stringify(tools))
  )
}

/** Keeps only recent Cua screenshots while retaining every textual result. */
function retainRecentComputerUseImages(
  transcript: AgentToolTranscriptMessage[]
): AgentToolTranscriptMessage[] {
  const retainedImageIndexes = new Set<number>()
  for (
    let index = transcript.length - 1;
    index >= 0 && retainedImageIndexes.size < AGENT_RECENT_COMPUTER_USE_IMAGE_LIMIT;
    index -= 1
  ) {
    const message = transcript[index]
    if (
      message?.role === 'tool' &&
      message.toolName.startsWith('computer_use__') &&
      message.files?.length
    ) {
      retainedImageIndexes.add(index)
    }
  }

  return transcript.map((message, index) => {
    if (
      message.role !== 'tool' ||
      !message.toolName.startsWith('computer_use__') ||
      !message.files?.length ||
      retainedImageIndexes.has(index)
    ) {
      return message
    }

    return {
      role: message.role,
      toolCallId: message.toolCallId,
      toolName: message.toolName,
      content: message.content
    }
  })
}

/** Keeps both the beginning and ending of oversized agent context text. */
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
    data_preview: createAgentTextPreview(
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
  const lastUserIndex = transcript.findLastIndex((message) => message.role === 'user')
  if (lastUserIndex > exchanges[0]!.startIndex) {
    boundary = Math.min(boundary, lastUserIndex)
  }
  if (boundary <= 0) return null

  // Keep a bounded visual reference even when the recent tail is text-only.
  // Retain whole exchanges so parallel tool results never become orphaned.
  const boundedTranscript = retainRecentComputerUseImages(transcript)
  const visual = findCompletedToolExchanges(boundedTranscript)
    .filter((exchange) =>
      exchange.endIndex < boundary && exchange.toolMessages.some((message) =>
        message.toolName.startsWith('computer_use__') && message.files?.length
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
  const imageBoundedTranscript = retainRecentComputerUseImages(
    params.transcript
  )
  const estimatedInputTokensBeforePreparation = estimateAgentInputTokens(
    imageBoundedTranscript,
    params.systemPrompt,
    params.tools
  )
  // Only discard reloadable schemas here. The continuity summary owns text
  // reduction, so its trigger sees the real cost of the original evidence.
  const tools = params.forceCompaction ||
    estimatedInputTokensBeforePreparation > params.compactionTriggerTokens
    ? pruneInactiveToolkitSchemas(imageBoundedTranscript, params.tools)
    : params.tools
  return {
    transcript: imageBoundedTranscript,
    tools,
    estimatedInputTokensBeforePreparation,
    estimatedInputTokens: estimateAgentInputTokens(
      imageBoundedTranscript, params.systemPrompt, tools
    ),
    wasCompacted: tools.length < params.tools.length
  }
}
