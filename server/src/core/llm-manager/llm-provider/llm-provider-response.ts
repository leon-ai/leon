import { type AxiosResponse } from 'axios'

import { type NormalizedCompletionResult } from '@/core/llm-manager/llm-provider/llm-provider-types'
import {
  type CompletionParams,
  type OpenAIToolCall
} from '@/core/llm-manager/types'
import { readCompletionAccounting } from '@/core/llm-manager/usage-accounting'
import { LogHelper } from '@/helpers/log-helper'

/**
 * Accept object and serialized JSON response envelopes.
 */
export function parseProviderResponseData(rawData: unknown): Record<string, unknown> {
  if (rawData && typeof rawData === 'object' && !Array.isArray(rawData)) {
    return rawData as Record<string, unknown>
  }

  if (typeof rawData === 'string') {
    try {
      const parsed = JSON.parse(rawData)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // Fall through
    }
  }

  return {}
}

/**
 * Read reasoning fields from OpenAI-compatible response messages.
 */
export function extractOpenAICompatibleReasoningFragments(
  message: Record<string, unknown>
): string[] {
  const chunks: string[] = []
  const addChunk = (value: unknown): void => {
    if (typeof value !== 'string') {
      return
    }

    if (value.length === 0) {
      return
    }

    chunks.push(value)
  }

  addChunk(message['reasoning'])
  addChunk(message['reasoning_content'])

  const reasoningDetails = Array.isArray(message['reasoningDetails'])
    ? (message['reasoningDetails'] as unknown[])
    : Array.isArray(message['reasoning_details'])
      ? (message['reasoning_details'] as unknown[])
      : []
  for (const detail of reasoningDetails) {
    if (!detail || typeof detail !== 'object') {
      continue
    }

    const detailObject = detail as Record<string, unknown>
    addChunk(detailObject['text'])
    addChunk(detailObject['reasoning'])
    addChunk(detailObject['delta'])
  }

  const content = Array.isArray(message['content'])
    ? (message['content'] as unknown[])
    : []
  for (const block of content) {
    if (!block || typeof block !== 'object') {
      continue
    }

    const blockObject = block as Record<string, unknown>
    const type =
      typeof blockObject['type'] === 'string'
        ? (blockObject['type'] as string)
        : ''
    if (type.includes('reasoning')) {
      addChunk(blockObject['text'])
      addChunk(blockObject['reasoning'])
      addChunk(blockObject['delta'])
    }
  }

  return chunks
}

/**
 * Combine nonempty reasoning fragments without duplicate summaries.
 */
function extractOpenAICompatibleReasoning(
  message: Record<string, unknown>
): string {
  const uniqueChunks: string[] = []
  for (const chunk of extractOpenAICompatibleReasoningFragments(message)) {
    const trimmed = chunk.trim()
    if (!trimmed) {
      continue
    }

    if (!uniqueChunks.includes(trimmed)) {
      uniqueChunks.push(trimmed)
    }
  }

  return uniqueChunks.join('\n')
}

/**
 * Normalize chat completions, tool calls, usage, and local decode timings.
 */
export function normalizeCompletionResultForOpenAICompatibleProvider(
  rawResult: AxiosResponse
): NormalizedCompletionResult {
  const parsedCompletionResult = parseProviderResponseData(rawResult.data)
  const choices = Array.isArray(parsedCompletionResult['choices'])
    ? (parsedCompletionResult['choices'] as Record<string, unknown>[])
    : []
  const firstChoice = choices[0]
  const message =
    firstChoice && typeof firstChoice['message'] === 'object'
      ? (firstChoice['message'] as Record<string, unknown>)
      : {}
  const usage =
    parsedCompletionResult['usage'] &&
    typeof parsedCompletionResult['usage'] === 'object'
      ? (parsedCompletionResult['usage'] as Record<string, unknown>)
      : {}
  const timings =
    parsedCompletionResult['timings'] &&
    typeof parsedCompletionResult['timings'] === 'object'
      ? (parsedCompletionResult['timings'] as Record<string, unknown>)
      : {}

  const contentField = message['content']
  const normalizedContent =
    typeof contentField === 'string'
      ? contentField
      : Array.isArray(contentField)
        ? (contentField as Record<string, unknown>[])
            .map((part) => {
              if (typeof part['text'] === 'string') {
                return part['text'] as string
              }
              return ''
            })
            .join('')
        : ''

  const result: NormalizedCompletionResult = {
    rawResult: normalizedContent,
    accounting: readCompletionAccounting(usage),
    usedInputTokens:
      typeof usage['prompt_tokens'] === 'number'
        ? (usage['prompt_tokens'] as number)
        : typeof usage['promptTokens'] === 'number'
          ? (usage['promptTokens'] as number)
          : typeof usage['input_tokens'] === 'number'
            ? (usage['input_tokens'] as number)
        : 0,
    usedOutputTokens:
      typeof usage['completion_tokens'] === 'number'
        ? (usage['completion_tokens'] as number)
        : typeof usage['completionTokens'] === 'number'
          ? (usage['completionTokens'] as number)
          : typeof usage['output_tokens'] === 'number'
            ? (usage['output_tokens'] as number)
        : 0
  }

  const finishReason = firstChoice?.['finish_reason'] ?? firstChoice?.['finishReason']
  if (typeof finishReason === 'string' && finishReason) {
    result.finishReason = finishReason
  }

  const providerDecodeDurationMs =
    typeof timings['predicted_ms'] === 'number'
      ? (timings['predicted_ms'] as number)
      : typeof timings['predictedMs'] === 'number'
        ? (timings['predictedMs'] as number)
        : 0
  const providerTokensPerSecond =
    typeof timings['predicted_per_second'] === 'number'
      ? (timings['predicted_per_second'] as number)
      : typeof timings['predictedPerSecond'] === 'number'
        ? (timings['predictedPerSecond'] as number)
        : 0
  if (providerDecodeDurationMs > 0) {
    result.providerDecodeDurationMs = providerDecodeDurationMs
  }
  if (providerTokensPerSecond > 0) {
    result.providerTokensPerSecond = providerTokensPerSecond
  }

  const reasoning = extractOpenAICompatibleReasoning(message)
  if (reasoning) {
    result.reasoning = reasoning
  }

  const toolCallsRaw = Array.isArray(message['tool_calls'])
    ? (message['tool_calls'] as unknown[])
    : Array.isArray(message['toolCalls'])
      ? (message['toolCalls'] as unknown[])
      : []
  if (toolCallsRaw.length > 0) {
    const normalizedToolCalls: OpenAIToolCall[] = []
    for (const [index, rawToolCall] of toolCallsRaw.entries()) {
      if (!rawToolCall || typeof rawToolCall !== 'object') {
        continue
      }

      const toolCallObject = rawToolCall as Record<string, unknown>
      const fn =
        toolCallObject['function'] &&
        typeof toolCallObject['function'] === 'object'
          ? (toolCallObject['function'] as Record<string, unknown>)
          : {}
      const fnName = typeof fn['name'] === 'string' ? (fn['name'] as string) : ''
      const fnArguments =
        typeof fn['arguments'] === 'string'
          ? (fn['arguments'] as string)
          : fn['arguments'] && typeof fn['arguments'] === 'object'
            ? JSON.stringify(fn['arguments'])
            : ''

      normalizedToolCalls.push({
        id:
          typeof toolCallObject['id'] === 'string'
            ? (toolCallObject['id'] as string)
            : `tool_call_${index}`,
        type: 'function',
        function: {
          name: fnName,
          arguments: fnArguments
        }
      })
    }

    if (normalizedToolCalls.length > 0) {
      result.toolCalls = normalizedToolCalls
    }
  }

  return result
}

/**
 * Convert a Responses API function call into Leon's tool-call contract.
 */
function toOpenAIResponsesToolCall(
  item: Record<string, unknown>,
  fallbackIndex: number
): OpenAIToolCall | null {
  const name = typeof item['name'] === 'string' ? (item['name'] as string) : ''
  if (!name) {
    return null
  }

  const rawArguments = item['arguments']
  const argumentsString =
    typeof rawArguments === 'string'
      ? rawArguments
      : rawArguments && typeof rawArguments === 'object'
        ? JSON.stringify(rawArguments)
        : ''

  const id =
    typeof item['call_id'] === 'string'
      ? (item['call_id'] as string)
      : typeof item['callId'] === 'string'
        ? (item['callId'] as string)
      : typeof item['id'] === 'string'
        ? (item['id'] as string)
        : `tool_call_${fallbackIndex}`

  return {
    id,
    type: 'function',
    function: {
      name,
      arguments: argumentsString
    }
  }
}

/**
 * Read assistant text from Responses API output items.
 */
export function extractOpenAIResponsesText(
  parsedCompletionResult: Record<string, unknown>
): string {
  if (typeof parsedCompletionResult['output_text'] === 'string') {
    return parsedCompletionResult['output_text'] as string
  }
  if (typeof parsedCompletionResult['outputText'] === 'string') {
    return parsedCompletionResult['outputText'] as string
  }

  const output = Array.isArray(parsedCompletionResult['output'])
    ? (parsedCompletionResult['output'] as Record<string, unknown>[])
    : []

  const textParts: string[] = []

  for (const item of output) {
    const itemType =
      typeof item['type'] === 'string' ? (item['type'] as string) : ''

    if (itemType !== 'message') {
      continue
    }

    const content = Array.isArray(item['content'])
      ? (item['content'] as Record<string, unknown>[])
      : []

    for (const contentBlock of content) {
      const blockType =
        typeof contentBlock['type'] === 'string'
          ? (contentBlock['type'] as string)
          : ''
      if (blockType !== 'output_text' && blockType !== 'text') {
        continue
      }

      if (typeof contentBlock['text'] === 'string') {
        textParts.push(contentBlock['text'] as string)
      }
    }
  }

  return textParts.join('')
}

/**
 * Collect function calls from a completed Responses API response.
 */
export function extractOpenAIResponsesToolCalls(
  parsedCompletionResult: Record<string, unknown>
): OpenAIToolCall[] {
  const output = Array.isArray(parsedCompletionResult['output'])
    ? (parsedCompletionResult['output'] as Record<string, unknown>[])
    : []

  const toolCalls: OpenAIToolCall[] = []
  for (const [index, item] of output.entries()) {
    const itemType =
      typeof item['type'] === 'string' ? (item['type'] as string) : ''
    if (itemType !== 'function_call') {
      continue
    }

    const toolCall = toOpenAIResponsesToolCall(item, index)
    if (toolCall) {
      toolCalls.push(toolCall)
    }
  }

  return toolCalls
}

/**
 * Read reasoning summaries and text from a Responses API item.
 */
function extractOpenAIResponsesReasoningFromItem(
  item: Record<string, unknown>
): string[] {
  const chunks: string[] = []
  const addChunk = (value: unknown): void => {
    if (typeof value !== 'string' || value.length === 0) {
      return
    }

    chunks.push(value)
  }

  const itemType = typeof item['type'] === 'string' ? (item['type'] as string) : ''
  if (!itemType.includes('reasoning')) {
    return chunks
  }

  addChunk(item['text'])
  addChunk(item['reasoning'])
  addChunk(item['summary_text'])
  addChunk(item['summaryText'])

  const summary = Array.isArray(item['summary']) ? (item['summary'] as unknown[]) : []
  for (const part of summary) {
    if (!part || typeof part !== 'object') {
      continue
    }

    const partObject = part as Record<string, unknown>
    addChunk(partObject['text'])
    addChunk(partObject['summary_text'])
    addChunk(partObject['summaryText'])
  }

  const content = Array.isArray(item['content']) ? (item['content'] as unknown[]) : []
  for (const block of content) {
    if (!block || typeof block !== 'object') {
      continue
    }

    const blockObject = block as Record<string, unknown>
    const blockType =
      typeof blockObject['type'] === 'string'
        ? (blockObject['type'] as string)
        : ''
    if (!blockType.includes('reasoning')) {
      continue
    }

    addChunk(blockObject['text'])
    addChunk(blockObject['reasoning'])
    addChunk(blockObject['summary_text'])
    addChunk(blockObject['summaryText'])
    addChunk(blockObject['delta'])
  }

  return chunks
}

/**
 * Read reasoning from complete responses and incremental events.
 */
export function extractOpenAIResponsesReasoningFragments(
  parsedChunk: Record<string, unknown>,
  eventName: string
): string[] {
  const chunks: string[] = []
  const addChunk = (value: unknown): void => {
    if (typeof value !== 'string' || value.length === 0) {
      return
    }

    chunks.push(value)
  }

  const type =
    typeof parsedChunk['type'] === 'string'
      ? (parsedChunk['type'] as string)
      : eventName
  if (type.includes('reasoning')) {
    addChunk(parsedChunk['delta'])
    addChunk(parsedChunk['text'])
    addChunk(parsedChunk['reasoning'])
    addChunk(parsedChunk['summary_text'])
    addChunk(parsedChunk['summaryText'])
  }

  const item =
    parsedChunk['item'] && typeof parsedChunk['item'] === 'object'
      ? (parsedChunk['item'] as Record<string, unknown>)
      : null
  if (item) {
    chunks.push(...extractOpenAIResponsesReasoningFromItem(item))
  }

  const output = Array.isArray(parsedChunk['output'])
    ? (parsedChunk['output'] as unknown[])
    : []
  for (const outputItem of output) {
    if (!outputItem || typeof outputItem !== 'object') {
      continue
    }

    chunks.push(
      ...extractOpenAIResponsesReasoningFromItem(
        outputItem as Record<string, unknown>
      )
    )
  }

  const response =
    parsedChunk['response'] && typeof parsedChunk['response'] === 'object'
      ? (parsedChunk['response'] as Record<string, unknown>)
      : null
  if (response) {
    const responseOutput = Array.isArray(response['output'])
      ? (response['output'] as unknown[])
      : []
    for (const outputItem of responseOutput) {
      if (!outputItem || typeof outputItem !== 'object') {
        continue
      }

      chunks.push(
        ...extractOpenAIResponsesReasoningFromItem(
          outputItem as Record<string, unknown>
        )
      )
    }
  }

  return chunks
}

/**
 * Normalize Responses API output and accounting into a completion result.
 */
export function normalizeCompletionResultForOpenAIResponsesProvider(
  rawResult: AxiosResponse
): NormalizedCompletionResult {
  const parsedCompletionResult = parseProviderResponseData(rawResult.data)
  const usage =
    parsedCompletionResult['usage'] &&
    typeof parsedCompletionResult['usage'] === 'object'
      ? (parsedCompletionResult['usage'] as Record<string, unknown>)
      : {}

  const toolCalls = extractOpenAIResponsesToolCalls(parsedCompletionResult)
  const result: NormalizedCompletionResult = {
    rawResult: extractOpenAIResponsesText(parsedCompletionResult),
    accounting: readCompletionAccounting(usage),
    usedInputTokens:
      typeof usage['input_tokens'] === 'number'
        ? (usage['input_tokens'] as number)
        : typeof usage['inputTokens'] === 'number'
          ? (usage['inputTokens'] as number)
        : 0,
    usedOutputTokens:
      typeof usage['output_tokens'] === 'number'
        ? (usage['output_tokens'] as number)
        : typeof usage['outputTokens'] === 'number'
          ? (usage['outputTokens'] as number)
        : 0
  }

  const responseStatus = parsedCompletionResult['status']
  const incompleteDetails =
    parsedCompletionResult['incomplete_details'] &&
    typeof parsedCompletionResult['incomplete_details'] === 'object'
      ? (parsedCompletionResult['incomplete_details'] as Record<string, unknown>)
      : null
  const incompleteReason = incompleteDetails?.['reason']
  if (typeof incompleteReason === 'string' && incompleteReason) {
    result.finishReason = incompleteReason
  } else if (responseStatus === 'incomplete') {
    result.finishReason = responseStatus
  }

  if (toolCalls.length > 0) {
    result.toolCalls = toolCalls
  }

  const reasoningChunks = extractOpenAIResponsesReasoningFragments(
    parsedCompletionResult,
    ''
  )
  if (reasoningChunks.length > 0) {
    const uniqueReasoning: string[] = []
    for (const chunk of reasoningChunks) {
      const trimmed = chunk.trim()
      if (!trimmed || uniqueReasoning.includes(trimmed)) {
        continue
      }

      uniqueReasoning.push(trimmed)
    }

    if (uniqueReasoning.length > 0) {
      result.reasoning = uniqueReasoning.join('\n')
    }
  }

  return result
}

/**
 * Apply Leon's existing display cleanup to completion text.
 */
export function cleanUpResult(str: string): string {
  // If starts and end with a double quote, remove them
  if (str.startsWith('"') && str.endsWith('"')) {
    return str.slice(1, -1)
  }

  str = str.replace(/\*laugh\*/g, '😂')
  str = str.replace(/\*winks?\*/g, '😉')
  str = str.replace(/\*sigh\*/g, '😔')

  // Remove all newlines at the beginning
  str = str.replace(/^\n+/, '')

  return str
}

/**
 * Recover structured output while preserving the plain-text fallback.
 */
export function parseCompletionOutput(
  rawResultString: string,
  isJSONMode: boolean,
  completionParams: CompletionParams
): string {
  if (!isJSONMode) {
    return rawResultString
  }

  const extractJsonSubstring = (input: string): string | null => {
    const firstBrace = input.indexOf('{')
    const firstBracket = input.indexOf('[')
    const startIndex =
      firstBrace !== -1 && firstBracket !== -1
        ? Math.min(firstBrace, firstBracket)
        : Math.max(firstBrace, firstBracket)

    if (startIndex === -1) {
      return null
    }

    const endIndex =
      input[startIndex] === '{'
        ? input.lastIndexOf('}')
        : input.lastIndexOf(']')

    if (endIndex <= startIndex) {
      return null
    }

    return input.slice(startIndex, endIndex + 1)
  }

  const strippedCodeFence = rawResultString
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim()
  const extracted = extractJsonSubstring(strippedCodeFence)
  const candidates = [
    rawResultString.trim(),
    strippedCodeFence,
    extracted
  ].filter((candidate): candidate is string => Boolean(candidate))

  // Last resort for truncated object-only payloads.
  if (
    strippedCodeFence.startsWith('{') &&
    !strippedCodeFence.endsWith('}')
  ) {
    candidates.push(`${strippedCodeFence}}`)
  }

  let lastError: Error | null = null
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch (error) {
      lastError = error as Error
    }
  }

  const rawTrimmed = rawResultString.trim()
  const looksStructuredPayload =
    /^(\{|\[|```)/.test(rawTrimmed)

  LogHelper.title('LLM Provider')
  if (looksStructuredPayload) {
    LogHelper.warning(
      `Failed to parse JSON output for ${completionParams.dutyType}: ${
        lastError?.message || 'unknown parse error'
      }`
    )
  } else {
    LogHelper.debug(
      `JSON parsing skipped warning for ${completionParams.dutyType}: provider returned plain text fallback`
    )
  }
  return rawResultString
}
