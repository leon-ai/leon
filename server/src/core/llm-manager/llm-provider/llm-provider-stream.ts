import { Readable } from 'node:stream'

import { type AxiosResponse } from 'axios'

import {
  extractOpenAICompatibleReasoningFragments,
  extractOpenAIResponsesReasoningFragments,
  extractOpenAIResponsesText,
  extractOpenAIResponsesToolCalls
} from '@/core/llm-manager/llm-provider/llm-provider-response'
import { type NormalizedCompletionResult } from '@/core/llm-manager/llm-provider/llm-provider-types'
import { mergeStreamingChunk } from '@/core/llm-manager/streaming-chunk'
import { recordInferenceUsage } from '@/core/llm-manager/llm-usage/usage-context'
import {
  LLMProviders,
  type CompletionParams,
  type OpenAIToolCall
} from '@/core/llm-manager/types'
import {
  readCompletionAccounting,
  type CompletionAccounting
} from '@/core/llm-manager/llm-usage/usage-accounting'

/**
 * Recognize Node streams and provider async iterables.
 */
export function isReadableStream(value: unknown): value is Readable {
  return (
    value instanceof Readable ||
    (!!value &&
      typeof value === 'object' &&
      typeof (value as { [Symbol.asyncIterator]?: unknown })[
        Symbol.asyncIterator
      ] === 'function')
  )
}

/**
 * Assemble raw provider streams into text, reasoning, tool calls, and usage.
 */
export async function normalizeStreamingCompletionResult(
  rawResult: AxiosResponse,
  completionParams: CompletionParams,
  providerName: LLMProviders
): Promise<NormalizedCompletionResult> {
  const responseStream = rawResult.data
  if (!isReadableStream(responseStream)) {
    return {
      rawResult: '',
      usedInputTokens: 0,
      usedOutputTokens: 0
    }
  }

  let textOutput = ''
  let reasoningOutput = ''
  let accounting: CompletionAccounting = {}
  let usedInputTokens = 0
  let usedOutputTokens = 0
  let providerDecodeDurationMs = 0
  let providerTokensPerSecond = 0
  let finishReason: string | undefined
  let buffer = ''

  const toolCallsByIndex: Record<number, OpenAIToolCall> = {}
  const toolCallsById: Record<string, OpenAIToolCall> = {}
  const toolCallOrder: string[] = []
  const reasoningChunkCache = new Set<string>()
  const isResponsesAPIProvider = [
    LLMProviders.OpenAI,
    LLMProviders.OpenRouter
  ].includes(providerName)

  const appendReasoningChunk = (reasoningChunk: string): void => {
    if (!reasoningChunk) {
      return
    }

    const trimmed = reasoningChunk.trim()
    if (!trimmed) {
      return
    }

    if (trimmed.length >= 16 && reasoningChunkCache.has(trimmed)) {
      return
    }

    const mergedChunk = mergeStreamingChunk(reasoningOutput, reasoningChunk)
    if (!mergedChunk || !mergedChunk.trim()) {
      if (trimmed.length >= 16) {
        reasoningChunkCache.add(trimmed)
      }
      return
    }

    reasoningOutput += mergedChunk
    completionParams.onReasoningToken?.(mergedChunk)

    if (trimmed.length >= 16) {
      reasoningChunkCache.add(trimmed)
    }
  }

  const updateTokenUsageFromObject = (
    usage: Record<string, unknown>,
    type: 'chat' | 'responses'
  ): void => {
    recordInferenceUsage(usage)
    accounting = { ...accounting, ...readCompletionAccounting(usage) }
    const inputTokens =
      type === 'chat'
        ? (usage['prompt_tokens'] ?? usage['promptTokens'])
        : (usage['input_tokens'] ?? usage['inputTokens'])
    const outputTokens =
      type === 'chat'
        ? (usage['completion_tokens'] ?? usage['completionTokens'])
        : (usage['output_tokens'] ?? usage['outputTokens'])

    if (typeof inputTokens === 'number' && Number.isFinite(inputTokens)) {
      usedInputTokens = inputTokens
    }
    if (typeof outputTokens === 'number' && Number.isFinite(outputTokens)) {
      usedOutputTokens = outputTokens
    }
  }

  const updateTimingFromObject = (payload: Record<string, unknown>): void => {
    const timings =
      payload['timings'] && typeof payload['timings'] === 'object'
        ? (payload['timings'] as Record<string, unknown>)
        : null

    if (!timings) {
      return
    }

    const predictedMs =
      typeof timings['predicted_ms'] === 'number'
        ? (timings['predicted_ms'] as number)
        : typeof timings['predictedMs'] === 'number'
          ? (timings['predictedMs'] as number)
          : 0

    if (predictedMs > 0) {
      providerDecodeDurationMs = predictedMs
    }

    const predictedPerSecond =
      typeof timings['predicted_per_second'] === 'number'
        ? (timings['predicted_per_second'] as number)
        : typeof timings['predictedPerSecond'] === 'number'
          ? (timings['predictedPerSecond'] as number)
          : 0

    if (predictedPerSecond > 0) {
      providerTokensPerSecond = predictedPerSecond
    }
  }

  const getOrCreateResponseToolCall = (
    toolCallId: string,
    fallbackIndex: number
  ): OpenAIToolCall => {
    if (!toolCallsById[toolCallId]) {
      const id = toolCallId || `tool_call_${fallbackIndex}`
      toolCallsById[toolCallId] = {
        id,
        type: 'function',
        function: {
          name: '',
          arguments: ''
        }
      }
      toolCallOrder.push(toolCallId)
    }

    return toolCallsById[toolCallId]!
  }

  const parseSSEEventBlock = (
    eventBlock: string
  ): { eventName: string, data: string } | null => {
    const lines = eventBlock.split('\n')
    let eventName = ''
    const dataLines: string[] = []

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line || line.startsWith(':')) {
        continue
      }

      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim()
        continue
      }
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim())
      }
    }

    if (dataLines.length === 0) {
      return null
    }

    return {
      eventName,
      data: dataLines.join('\n')
    }
  }

  const applyOpenAICompatibleStreamingChunk = (
    parsedChunk: Record<string, unknown>
  ): void => {
    updateTimingFromObject(parsedChunk)
    const usage = parsedChunk['usage']
    if (usage && typeof usage === 'object') {
      updateTokenUsageFromObject(usage as Record<string, unknown>, 'chat')
    }

    const choices = parsedChunk['choices']
    if (!Array.isArray(choices) || choices.length === 0) {
      return
    }
    const firstChoice = choices[0]
    if (!firstChoice || typeof firstChoice !== 'object') {
      return
    }

    const choiceObject = firstChoice as Record<string, unknown>
    const chunkFinishReason =
      choiceObject['finish_reason'] ?? choiceObject['finishReason']
    if (typeof chunkFinishReason === 'string' && chunkFinishReason) {
      finishReason = chunkFinishReason
    }
    const delta = choiceObject['delta']
    if (!delta || typeof delta !== 'object') {
      return
    }

    const deltaObject = delta as Record<string, unknown>
    const contentDelta = deltaObject['content']
    if (typeof contentDelta === 'string' && contentDelta.length > 0) {
      textOutput += contentDelta
      completionParams.onToken?.(contentDelta)
    }

    for (const reasoningChunk of extractOpenAICompatibleReasoningFragments(
      deltaObject
    )) {
      appendReasoningChunk(reasoningChunk)
    }

    const toolCalls = Array.isArray(deltaObject['tool_calls'])
      ? (deltaObject['tool_calls'] as unknown[])
      : Array.isArray(deltaObject['toolCalls'])
        ? (deltaObject['toolCalls'] as unknown[])
        : null
    if (!Array.isArray(toolCalls)) {
      return
    }

    for (const partialToolCall of toolCalls) {
      if (!partialToolCall || typeof partialToolCall !== 'object') {
        continue
      }

      const toolCallData = partialToolCall as Record<string, unknown>
      const index =
        typeof toolCallData['index'] === 'number' &&
        Number.isInteger(toolCallData['index'])
          ? (toolCallData['index'] as number)
          : 0
      const id =
        typeof toolCallData['id'] === 'string' ? toolCallData['id'] : ''
      const type =
        typeof toolCallData['type'] === 'string'
          ? toolCallData['type']
          : 'function'
      const fn =
        toolCallData['function'] && typeof toolCallData['function'] === 'object'
          ? (toolCallData['function'] as Record<string, unknown>)
          : {}
      const functionName =
        typeof fn['name'] === 'string' ? (fn['name'] as string) : ''
      const functionArguments =
        typeof fn['arguments'] === 'string' ? (fn['arguments'] as string) : ''

      if (!toolCallsByIndex[index]) {
        toolCallsByIndex[index] = {
          id: id || `tool_call_${index}`,
          type: type === 'function' ? 'function' : 'function',
          function: {
            name: functionName,
            arguments: functionArguments
          }
        }
        continue
      }

      const current = toolCallsByIndex[index]!
      if (id) {
        current.id = id
      }
      if (functionName) {
        current.function.name = functionName
      }
      if (functionArguments) {
        current.function.arguments += functionArguments
      }
    }
  }

  const applyOpenAIResponsesStreamingChunk = (
    parsedChunk: Record<string, unknown>,
    eventName: string
  ): void => {
    updateTimingFromObject(parsedChunk)
    const type =
      typeof parsedChunk['type'] === 'string'
        ? (parsedChunk['type'] as string)
        : eventName
    const response =
      parsedChunk['response'] && typeof parsedChunk['response'] === 'object'
        ? (parsedChunk['response'] as Record<string, unknown>)
        : null
    const responseStatus = response?.['status'] ?? parsedChunk['status']
    if (responseStatus === 'incomplete' || type === 'response.incomplete') {
      const incompleteDetails =
        response?.['incomplete_details'] &&
        typeof response['incomplete_details'] === 'object'
          ? (response['incomplete_details'] as Record<string, unknown>)
          : null
      const incompleteReason = incompleteDetails?.['reason']
      finishReason =
        typeof incompleteReason === 'string' && incompleteReason
          ? incompleteReason
          : 'incomplete'
    }

    for (const reasoningChunk of extractOpenAIResponsesReasoningFragments(
      parsedChunk,
      eventName
    )) {
      appendReasoningChunk(reasoningChunk)
    }

    if (type === 'response.output_text.delta') {
      const delta = parsedChunk['delta']
      if (typeof delta === 'string' && delta.length > 0) {
        textOutput += delta
        completionParams.onToken?.(delta)
      }
    }

    if (type === 'response.function_call_arguments.delta') {
      const itemId =
        typeof parsedChunk['item_id'] === 'string'
          ? (parsedChunk['item_id'] as string)
          : typeof parsedChunk['itemId'] === 'string'
            ? (parsedChunk['itemId'] as string)
          : typeof parsedChunk['call_id'] === 'string'
            ? (parsedChunk['call_id'] as string)
            : typeof parsedChunk['callId'] === 'string'
              ? (parsedChunk['callId'] as string)
            : ''
      const delta =
        typeof parsedChunk['delta'] === 'string'
          ? (parsedChunk['delta'] as string)
          : ''
      if (itemId) {
        const toolCall = getOrCreateResponseToolCall(itemId, toolCallOrder.length)
        if (delta) {
          toolCall.function.arguments += delta
        }
        if (
          !toolCall.function.name &&
          typeof parsedChunk['name'] === 'string'
        ) {
          toolCall.function.name = parsedChunk['name'] as string
        }
      }
    }

    if (type === 'response.function_call_arguments.done') {
      const itemId =
        typeof parsedChunk['item_id'] === 'string'
          ? (parsedChunk['item_id'] as string)
          : typeof parsedChunk['itemId'] === 'string'
            ? (parsedChunk['itemId'] as string)
            : typeof parsedChunk['call_id'] === 'string'
              ? (parsedChunk['call_id'] as string)
              : typeof parsedChunk['callId'] === 'string'
                ? (parsedChunk['callId'] as string)
                : ''
      if (itemId) {
        const toolCall = getOrCreateResponseToolCall(itemId, toolCallOrder.length)
        if (
          !toolCall.function.name &&
          typeof parsedChunk['name'] === 'string'
        ) {
          toolCall.function.name = parsedChunk['name'] as string
        }
        const completedArgs = parsedChunk['arguments']
        if (typeof completedArgs === 'string' && completedArgs.length > 0) {
          toolCall.function.arguments = completedArgs
        } else if (completedArgs && typeof completedArgs === 'object') {
          toolCall.function.arguments = JSON.stringify(completedArgs)
        }
      }
    }

    if (
      type === 'response.output_item.added' ||
      type === 'response.output_item.done'
    ) {
      const item =
        parsedChunk['item'] && typeof parsedChunk['item'] === 'object'
          ? (parsedChunk['item'] as Record<string, unknown>)
          : {}
      const itemType =
        typeof item['type'] === 'string' ? (item['type'] as string) : ''

      if (itemType === 'function_call') {
        const itemId =
          typeof item['id'] === 'string'
            ? (item['id'] as string)
            : typeof item['call_id'] === 'string'
              ? (item['call_id'] as string)
              : typeof item['callId'] === 'string'
                ? (item['callId'] as string)
              : ''

        if (itemId) {
          const toolCall = getOrCreateResponseToolCall(itemId, toolCallOrder.length)
          if (typeof item['call_id'] === 'string' && item['call_id']) {
            toolCall.id = item['call_id'] as string
          } else if (typeof item['callId'] === 'string' && item['callId']) {
            toolCall.id = item['callId'] as string
          }
          if (typeof item['name'] === 'string' && item['name']) {
            toolCall.function.name = item['name'] as string
          }
          const args = item['arguments']
          if (typeof args === 'string' && args.length > 0) {
            toolCall.function.arguments = args
          } else if (args && typeof args === 'object') {
            toolCall.function.arguments = JSON.stringify(args)
          }
        }
      } else if (itemType === 'message' && textOutput.length === 0) {
        const messageText = extractOpenAIResponsesText({
          output: [item]
        })
        if (messageText) {
          textOutput += messageText
        }
      }
    }

    const usageCandidate =
      parsedChunk['response'] && typeof parsedChunk['response'] === 'object'
        ? (
            (parsedChunk['response'] as Record<string, unknown>)[
              'usage'
            ] as Record<string, unknown> | undefined
          )
        : undefined
    if (usageCandidate && typeof usageCandidate === 'object') {
      updateTokenUsageFromObject(usageCandidate, 'responses')
    } else if (parsedChunk['usage'] && typeof parsedChunk['usage'] === 'object') {
      updateTokenUsageFromObject(
        parsedChunk['usage'] as Record<string, unknown>,
        'responses'
      )
    }

    if (type === 'response.completed') {
      const response =
        parsedChunk['response'] && typeof parsedChunk['response'] === 'object'
          ? (parsedChunk['response'] as Record<string, unknown>)
          : {}

      if (textOutput.length === 0) {
        textOutput = extractOpenAIResponsesText(response)
      }

      if (toolCallOrder.length === 0) {
        for (const [index, toolCall] of extractOpenAIResponsesToolCalls(response)
          .entries()) {
          const mapKey = `completed_${index}`
          toolCallsById[mapKey] = toolCall
          toolCallOrder.push(mapKey)
        }
      }
    }
  }

  for await (const chunk of responseStream as AsyncIterable<unknown>) {
    completionParams.onStreamEvent?.({ type: 'transport-activity', transport: 'http' })

    if (chunk && typeof chunk === 'object' && !Buffer.isBuffer(chunk)) {
      const parsedChunk = chunk as Record<string, unknown>
      if (isResponsesAPIProvider) {
        applyOpenAIResponsesStreamingChunk(parsedChunk, '')
      } else {
        applyOpenAICompatibleStreamingChunk(parsedChunk)
      }
      continue
    }

    const chunkString =
      typeof chunk === 'string' ? chunk : (chunk as Buffer).toString('utf8')
    buffer += chunkString.replace(/\r\n/g, '\n')

    let separatorIndex = buffer.indexOf('\n\n')
    while (separatorIndex !== -1) {
      const eventBlock = buffer.slice(0, separatorIndex)
      buffer = buffer.slice(separatorIndex + 2)

      const parsedEvent = parseSSEEventBlock(eventBlock)
      if (!parsedEvent || !parsedEvent.data || parsedEvent.data === '[DONE]') {
        separatorIndex = buffer.indexOf('\n\n')
        continue
      }

      let parsedChunk: Record<string, unknown>
      try {
        parsedChunk = JSON.parse(parsedEvent.data) as Record<string, unknown>
      } catch {
        separatorIndex = buffer.indexOf('\n\n')
        continue
      }

      if (isResponsesAPIProvider) {
        applyOpenAIResponsesStreamingChunk(parsedChunk, parsedEvent.eventName)
      } else {
        applyOpenAICompatibleStreamingChunk(parsedChunk)
      }

      separatorIndex = buffer.indexOf('\n\n')
    }
  }

  if (buffer.trim()) {
    const parsedEvent = parseSSEEventBlock(buffer)
    if (parsedEvent && parsedEvent.data && parsedEvent.data !== '[DONE]') {
      try {
        const parsedChunk = JSON.parse(parsedEvent.data) as Record<
          string,
          unknown
        >
        if (isResponsesAPIProvider) {
          applyOpenAIResponsesStreamingChunk(parsedChunk, parsedEvent.eventName)
        } else {
          applyOpenAICompatibleStreamingChunk(parsedChunk)
        }
      } catch {
        // Ignore malformed trailing chunk
      }
    }
  }

  const toolCalls =
    isResponsesAPIProvider
      ? toolCallOrder
          .map((key) => toolCallsById[key]!)
          .filter((toolCall) => toolCall.function.name.length > 0)
      : Object.keys(toolCallsByIndex)
          .map((index) => Number(index))
          .sort((a, b) => a - b)
          .map((index) => toolCallsByIndex[index]!)

  return {
    rawResult: textOutput,
    accounting,
    usedInputTokens,
    usedOutputTokens,
    ...(providerDecodeDurationMs > 0 ? { providerDecodeDurationMs } : {}),
    ...(providerTokensPerSecond > 0 ? { providerTokensPerSecond } : {}),
    ...(reasoningOutput.trim().length > 0
      ? { reasoning: reasoningOutput.trim() }
      : {}),
    ...(finishReason ? { finishReason } : {}),
    ...(toolCalls.length > 0 ? { toolCalls } : {})
  }
}
