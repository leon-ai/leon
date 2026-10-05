import { randomUUID } from 'node:crypto'

import { type AxiosResponse } from 'axios'

import {
  LOCAL_SERVER_PROVIDERS,
  STREAM_IDLE_TIMEOUT_ERROR_NAME
} from '@/core/llm-manager/llm-provider/llm-provider-constants'
import {
  buildProviderErrorDetails,
  buildProviderErrorMessage,
  createPromptAbortError,
  formatPromptErrorForLog,
  getConnectionErrorCode,
  isPromptAbortReason,
  prepareCompletionRetry,
  safeSerialize,
  truncateForLog,
  waitForRetry
} from '@/core/llm-manager/llm-provider/llm-provider-errors'
import {
  cleanUpResult,
  normalizeCompletionResultForOpenAICompatibleProvider,
  normalizeCompletionResultForOpenAIResponsesProvider,
  parseCompletionOutput,
  parseProviderResponseData
} from '@/core/llm-manager/llm-provider/llm-provider-response'
import {
  isReadableStream,
  normalizeStreamingCompletionResult
} from '@/core/llm-manager/llm-provider/llm-provider-stream'
import type {
  PreparedCompletionParams,
  CompletionResult,
  NormalizedCompletionResult,
  Provider
} from '@/core/llm-manager/llm-provider/llm-provider-types'
import {
  LLMProviders,
  type CompletionParams,
  type CompletionStreamEvent,
  type OpenAIToolCall,
  type ProviderReasoningItem,
  type PromptOrChatHistory
} from '@/core/llm-manager/types'
import { type CompletionAccounting } from '@/core/llm-manager/usage-accounting'
import { LogHelper } from '@/helpers/log-helper'

const LEADING_EMPTY_THINKING_BLOCK_PATTERN = /^(?:\s*<think>\s*<\/think>)+\s*/i

const EMPTY_COMPLETION_RETRY_DELAY_MS = 750

const STREAM_OUTPUT_EVENTS = new Set([
  'tool-input-start',
  'tool-input-delta',
  'tool-call-delta',
  'tool-call',
  'file',
  'tool-result',
  'source'
])

const REMOTE_STREAM_IDLE_TIMEOUT_MS = 30_000

/**
 * Execute one prepared completion, preserving cancellation and retry boundaries.
 */
export async function runCompletionAttempt(
  provider: Provider,
  providerName: LLMProviders,
  promptOrChatHistory: PromptOrChatHistory,
  completionParams: PreparedCompletionParams,
  measureExecutionTimeLabel: string,
  retry: (params: CompletionParams) => Promise<CompletionResult | null>,
  reportError: (message: string, preserveExisting?: boolean) => void
): Promise<CompletionResult | null> {
  const trackProviderErrors = completionParams.trackProviderErrors !== false

  const isJSONMode = completionParams.data !== null
  const shouldStreamOutput = completionParams.shouldStream === true
  const isRemoteProvider = !LOCAL_SERVER_PROVIDERS.has(providerName)

  const abortController = new AbortController()
  let timeoutHandle: NodeJS.Timeout | null = null
  let streamStallTimeoutHandle: NodeJS.Timeout | null = null
  let hasStartedStreaming = false
  const completionStartedAt = Date.now()
  let generationStartedAt: number | null = null
  let firstTokenAt: number | undefined
  let accounting: CompletionAccounting | undefined
  let firstEventAt: number | undefined
  let streamOpenedAt: number | undefined
  let lastEventAt: number | undefined
  let lastEvent = 'dispatched'
  let transport: string = isRemoteProvider
    ? providerName === LLMProviders.OpenAI && shouldStreamOutput
      ? 'websocket'
      : 'http'
    : 'local'
  let requestId: string | undefined
  let responseId: string | undefined
  let isReasoning = false
  const pendingHostedTools = new Set<string>()
  const attemptId = randomUUID()
  const idleTimeout = completionParams.streamIdleTimeout ?? (
    isRemoteProvider
      ? Math.min(REMOTE_STREAM_IDLE_TIMEOUT_MS, completionParams.timeout)
      : completionParams.timeout
  )
  const logAttempt = (outcome: string, error?: unknown): void => {
    const details = JSON.stringify({
      attemptId,
      startedAt: new Date(completionStartedAt).toISOString(),
      provider: providerName,
      model: provider.modelName,
      duty: completionParams.dutyType,
      reasoningEffort: completionParams.reasoningEffort,
      serviceTier: completionParams.serviceTier,
      transport,
      accounting,
      outcome,
      connectionErrorCode: getConnectionErrorCode(error),
      requestId,
      responseId,
      elapsedMs: Date.now() - completionStartedAt,
      inferenceTimeoutMs: completionParams.timeout,
      streamIdleTimeoutMs: idleTimeout,
      generationStartMs: generationStartedAt === null
        ? undefined
        : generationStartedAt - completionStartedAt,
      streamOpenMs: streamOpenedAt === undefined
        ? undefined
        : streamOpenedAt - completionStartedAt,
      firstEventMs: firstEventAt === undefined
        ? undefined
        : firstEventAt - completionStartedAt,
      firstTokenMs: firstTokenAt === undefined
        ? undefined
        : firstTokenAt - completionStartedAt,
      lastEvent,
      idleMs: lastEventAt === undefined ? undefined : Date.now() - lastEventAt
    })

    if (outcome === 'started' || outcome === 'completed') {
      LogHelper.debug(`LLM attempt ${details}`)
    } else {
      // Keep failed-attempt identifiers and timings in the profile error log.
      LogHelper.error(`LLM attempt ${details}`)
    }
  }
  // Attempt-level diagnosis can retry, but owner cancellation must survive it.
  const callerAbortSignal = completionParams.cancellationSignal
    ? AbortSignal.any([
        completionParams.cancellationSignal,
        ...(completionParams.signal ? [completionParams.signal] : [])
      ])
    : completionParams.signal
  const userOnToken = completionParams.onToken
  const userOnReasoningToken = completionParams.onReasoningToken

  type OnTokenChunk = Parameters<
    NonNullable<CompletionParams['onToken']>
  >[0]
  let rejectStreamStall: ((error: Error) => void) | null = null
  const clearStreamStallTimeout = (): void => {
    if (streamStallTimeoutHandle) {
      clearTimeout(streamStallTimeoutHandle)
      streamStallTimeoutHandle = null
    }
  }
  const resetStreamStallTimeout = (
    delay = isReasoning || pendingHostedTools.size > 0
      ? completionParams.timeout
      : idleTimeout
  ): void => {
    if (!shouldStreamOutput || !completionParams.timeout) {
      return
    }

    clearStreamStallTimeout()
    streamStallTimeoutHandle = setTimeout(() => {
      const error = new Error(
        `Timeout (${delay}ms) for "${completionParams.dutyType}" duty after streaming stalled`
      )
      error.name = STREAM_IDLE_TIMEOUT_ERROR_NAME

      if (!abortController.signal.aborted) {
        abortController.abort(error)
      }

      rejectStreamStall?.(error)
    }, delay)
  }
  const markStreamStarted = (): void => {
    if (!hasStartedStreaming) {
      hasStartedStreaming = true
      generationStartedAt = Date.now()
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
        timeoutHandle = null
        LogHelper.title('LLM Provider')
        LogHelper.debug(
          'Model generation activity started; using the stream activity watchdog'
        )
      }
    }
  }

  const recordActivity = (type: string): void => {
    firstEventAt ??= Date.now()
    lastEventAt = Date.now()
    lastEvent = type
  }
  const onTokenWithStreamStart = (chunk: OnTokenChunk): void => {
    if (chunk.length > 0) {
      firstTokenAt ??= Date.now()
      recordActivity('text-delta')
      markStreamStarted()
      resetStreamStallTimeout()
    }

    userOnToken?.(chunk)
  }
  const onReasoningTokenWithStreamStart = (reasoningChunk: string): void => {
    if (reasoningChunk.length > 0) {
      recordActivity('reasoning-delta')
      markStreamStarted()
      // Reasoning can include silent computation between visible summaries.
      resetStreamStallTimeout(completionParams.timeout)
    }

    userOnReasoningToken?.(reasoningChunk)
  }
  const onStreamEvent = (event: CompletionStreamEvent): void => {
    transport = event.transport ?? transport
    requestId = event.requestId ?? requestId
    responseId = event.responseId ?? responseId

    if (event.type === 'stream-open') {
      streamOpenedAt = Date.now()
    } else if (event.type !== 'stream-start') {
      recordActivity(event.type)
    }

    // Hosted tools can perform long work without emitting argument deltas.
    if (event.toolCallId) {
      if (event.type === 'tool-call' && event.providerExecuted) {
        pendingHostedTools.add(event.toolCallId)
      } else if (event.type === 'tool-result' && !event.preliminary) {
        pendingHostedTools.delete(event.toolCallId)
      }
    }

    if (event.type === 'finish') {
      // The model has finished; artifact persistence is local post-processing.
      clearStreamStallTimeout()

      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
        timeoutHandle = null
      }
    } else if (event.type === 'reasoning-start') {
      isReasoning = true
      markStreamStarted()
      resetStreamStallTimeout()
    } else if (event.type === 'reasoning-end') {
      isReasoning = false
      resetStreamStallTimeout()
    } else if (STREAM_OUTPUT_EVENTS.has(event.type)) {
      markStreamStarted()
      resetStreamStallTimeout()
    }

    completionParams.onStreamEvent?.(event)
  }
  const completionParamsWithAbort = {
    ...completionParams,
    shouldStream: shouldStreamOutput,
    onToken: onTokenWithStreamStart,
    onReasoningToken: onReasoningTokenWithStreamStart,
    onStreamEvent,
    signal: abortController.signal
  }

  logAttempt('started')

  let callerAbortListener: (() => void) | null = null
  const removeCallerAbortListener = (): void => {
    if (!callerAbortSignal || !callerAbortListener) {
      return
    }

    callerAbortSignal.removeEventListener('abort', callerAbortListener)
    callerAbortListener = null
  }
  const callerAbortPromise = new Promise((_, reject) => {
    if (!callerAbortSignal) {
      return
    }

    const rejectWithAbortReason = (): void => {
      if (!abortController.signal.aborted) {
        abortController.abort(callerAbortSignal.reason)
      }

      if (isPromptAbortReason(callerAbortSignal.reason)) {
        reject(createPromptAbortError(callerAbortSignal.reason))
        return
      }

      reject(
        callerAbortSignal.reason instanceof Error
          ? callerAbortSignal.reason
          : new Error('Prompt aborted by caller')
      )
    }

    if (callerAbortSignal.aborted) {
      rejectWithAbortReason()
      return
    }

    callerAbortListener = (): void => {
      rejectWithAbortReason()
    }

    callerAbortSignal.addEventListener('abort', callerAbortListener, {
      once: true
    })
  })

  let rawResultPromise: Promise<unknown>
  try {
    rawResultPromise = Promise.resolve(
      provider.runChatCompletion(
        promptOrChatHistory,
        completionParamsWithAbort
      )
    )
  } catch (e) {
    logAttempt('failed', e)
    removeCallerAbortListener()
    completionParams.cancellationSignal?.throwIfAborted()
    LogHelper.title('LLM Provider')
    LogHelper.error(
      `Error to complete prompt: ${formatPromptErrorForLog(e)}`
    )
    LogHelper.timeEnd(measureExecutionTimeLabel)

    if (trackProviderErrors) {
      reportError(
        buildProviderErrorMessage(
          providerName,
          formatPromptErrorForLog(e),
          buildProviderErrorDetails(e),
          isRemoteProvider
        )
      )
    }

    return null
  }
  // Ensure late rejections after timeout/abort are consumed to avoid
  // unhandled promise rejection noise when we already moved to a retry.
  void rawResultPromise.catch(() => undefined)

  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      if (hasStartedStreaming) {
        return
      }

      abortController.abort()
      reject(
        new Error(
          `Timeout (${completionParams.timeout}ms) for "${completionParams.dutyType}" duty`
        )
      )
    }, completionParams.timeout)
  })
  const streamStallTimeoutPromise = new Promise((_, reject) => {
    rejectStreamStall = reject
  })

  let rawResult
  let rawResultString

  try {
    rawResult = await Promise.race([
      rawResultPromise,
      timeoutPromise,
      streamStallTimeoutPromise,
      callerAbortPromise
    ])
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
    clearStreamStallTimeout()
  } catch (e) {
    logAttempt(e instanceof Error ? e.name : 'failed', e)
    removeCallerAbortListener()
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
    clearStreamStallTimeout()
    rejectStreamStall = null
    completionParams.cancellationSignal?.throwIfAborted()

    LogHelper.title('LLM Provider')
    LogHelper.error(
      `Error to complete prompt: ${formatPromptErrorForLog(e)}`
    )
    LogHelper.timeEnd(measureExecutionTimeLabel)

    const retryParams = await prepareCompletionRetry(
      e,
      completionParams,
      isRemoteProvider,
      abortController
    )

    if (retryParams) {
      return retry(retryParams)
    }

    if (trackProviderErrors) {
      const apiErrorDetails = buildProviderErrorDetails(e)
      const statusLike =
        e && typeof e === 'object' && 'statusCode' in e
          ? (e as { statusCode?: unknown }).statusCode
          : undefined

      reportError(
        buildProviderErrorMessage(
          providerName,
          statusLike !== undefined
            ? `${formatPromptErrorForLog(e)} (statusCode=${String(
                statusLike
              )})`
            : formatPromptErrorForLog(e),
          apiErrorDetails,
          isRemoteProvider
        ),
        true
      )
    }

    return null
  }

  removeCallerAbortListener()

  let usedInputTokens = 0
  let usedOutputTokens = 0
  let generationDurationMs = 0
  let providerDecodeDurationMs: number | undefined
  let providerTokensPerSecond: number | undefined
  let toolCalls: OpenAIToolCall[] | undefined
  let reasoning: string | undefined
  let reasoningItems: ProviderReasoningItem[] | undefined
  let finishReason: string | undefined

  // Normalize the completion result according to the provider.
  let remoteRawData: unknown = null
  let shouldUseRemoteStreaming = false

  try {
    remoteRawData =
      isRemoteProvider &&
      rawResult &&
      typeof rawResult === 'object' &&
      'data' in (rawResult as Record<string, unknown>)
        ? (rawResult as AxiosResponse).data
        : null
    const remoteStreamCandidate =
      remoteRawData !== null ? remoteRawData : rawResult
    const providerReturnedStream =
      isRemoteProvider && isReadableStream(remoteStreamCandidate)
    shouldUseRemoteStreaming =
      isRemoteProvider && shouldStreamOutput && providerReturnedStream

    if (
      isRemoteProvider &&
      shouldStreamOutput &&
      !providerReturnedStream &&
      !hasStartedStreaming
    ) {
      LogHelper.title('LLM Provider')
      LogHelper.debug(
        `Streaming requested but provider returned non-stream payload; falling back to non-stream normalization (type=${typeof remoteStreamCandidate})`
      )
    }

    if (shouldUseRemoteStreaming) {
      const streamResponse =
        remoteRawData !== null
          ? (rawResult as AxiosResponse)
          : ({
              data: remoteStreamCandidate
            } as AxiosResponse)
      resetStreamStallTimeout()
      const normalized = (await Promise.race([
        normalizeStreamingCompletionResult(
          streamResponse,
          completionParams,
          providerName
        ),
        streamStallTimeoutPromise,
        callerAbortPromise
      ])) as NormalizedCompletionResult

      rawResult = normalized.rawResult
      accounting = normalized.accounting
      usedInputTokens = normalized.usedInputTokens
      usedOutputTokens = normalized.usedOutputTokens
      providerDecodeDurationMs = normalized.providerDecodeDurationMs
      providerTokensPerSecond = normalized.providerTokensPerSecond
      generationDurationMs =
        normalized.generationDurationMs ??
        Math.max(Date.now() - (generationStartedAt ?? completionStartedAt), 0)
      toolCalls = normalized.toolCalls
      reasoning = normalized.reasoning
      reasoningItems = normalized.reasoningItems
      finishReason = normalized.finishReason
    } else if (
      [
        LLMProviders.Groq,
        LLMProviders.LlamaCPP,
        LLMProviders.SGLang,
        LLMProviders.ZAI,
        LLMProviders.DeepSeek,
        LLMProviders.MiniMax,
        LLMProviders.Anthropic,
        LLMProviders.MoonshotAI,
        LLMProviders.Cerebras,
        LLMProviders.HuggingFace,
        LLMProviders.Celeris
      ].includes(providerName)
    ) {
      const normalized = normalizeCompletionResultForOpenAICompatibleProvider(
        rawResult as AxiosResponse
      )

      rawResult = normalized.rawResult
      accounting = normalized.accounting
      usedInputTokens = normalized.usedInputTokens
      usedOutputTokens = normalized.usedOutputTokens
      providerDecodeDurationMs = normalized.providerDecodeDurationMs
      generationDurationMs = Math.max(
        Date.now() - (generationStartedAt ?? completionStartedAt),
        0
      )
      providerTokensPerSecond = normalized.providerTokensPerSecond
      toolCalls = normalized.toolCalls
      reasoning = normalized.reasoning
      reasoningItems = normalized.reasoningItems
      finishReason = normalized.finishReason
    } else if (
      [LLMProviders.OpenAI, LLMProviders.OpenRouter].includes(
        providerName
      )
    ) {
      const parsedResponseData = parseProviderResponseData(
        (rawResult as AxiosResponse).data
      )
      const normalized = Array.isArray(parsedResponseData['choices'])
        ? normalizeCompletionResultForOpenAICompatibleProvider(
            rawResult as AxiosResponse
          )
        : normalizeCompletionResultForOpenAIResponsesProvider(
            rawResult as AxiosResponse
          )

      rawResult = normalized.rawResult
      accounting = normalized.accounting
      usedInputTokens = normalized.usedInputTokens
      usedOutputTokens = normalized.usedOutputTokens
      providerDecodeDurationMs = normalized.providerDecodeDurationMs
      providerTokensPerSecond = normalized.providerTokensPerSecond
      generationDurationMs = Math.max(
        Date.now() - (generationStartedAt ?? completionStartedAt),
        0
      )
      toolCalls = normalized.toolCalls
      reasoning = normalized.reasoning
      reasoningItems = normalized.reasoningItems
      finishReason = normalized.finishReason
    } else {
      LogHelper.error(`The LLM provider "${providerName}" is not yet supported`)
      return null
    }

    rawResultString = rawResult as string

    if (typeof rawResult === 'string') {
      // Some llama.cpp templates leave empty reasoning blocks with thinking disabled.
      if (
        providerName === LLMProviders.LlamaCPP &&
        completionParams.disableThinking === true
      ) {
        rawResultString = rawResultString.replace(
          LEADING_EMPTY_THINKING_BLOCK_PATTERN,
          ''
        )
      }

      rawResultString = cleanUpResult(rawResultString)
    }

    if (reasoning && reasoning.trim()) {
      LogHelper.title('LLM Provider')
      LogHelper.debug(`Reasoning:\n${truncateForLog(reasoning)}`)

      if (!shouldUseRemoteStreaming && !hasStartedStreaming) {
        completionParams.onReasoningToken?.(reasoning)
      }
    }
  } catch (e) {
    clearStreamStallTimeout()
    rejectStreamStall = null
    LogHelper.title('LLM Provider')
    LogHelper.error(`Failed to normalize completion result: ${String(e)}`)
    LogHelper.timeEnd(measureExecutionTimeLabel)

    return null
  }
  clearStreamStallTimeout()
  rejectStreamStall = null

  logAttempt('completed')

  // Guard against silent empty provider responses which otherwise trigger
  // an unnecessary planning fallback and double latency.
  const isSuspiciousEmptyRemoteResult =
    isRemoteProvider &&
    !isJSONMode &&
    (!rawResultString || rawResultString.trim() === '') &&
    !toolCalls &&
    usedInputTokens === 0 &&
    usedOutputTokens === 0

  if (isSuspiciousEmptyRemoteResult) {
    const remainingRetries = completionParams.maxRetries ?? 0
    const providerPayloadSnippet =
      remoteRawData !== null
        ? truncateForLog(safeSerialize(remoteRawData))
        : ''

    LogHelper.title('LLM Provider')
    LogHelper.warning(
      `Received empty completion payload (no text/tool_calls/tokens) from "${providerName}".${providerPayloadSnippet ? ` Payload: ${providerPayloadSnippet}` : ''}`
    )

    if (remainingRetries > 0) {
      await waitForRetry(EMPTY_COMPLETION_RETRY_DELAY_MS)
      return retry({
        ...completionParams,
        maxRetries: remainingRetries - 1
      })
    }

    if (trackProviderErrors) {
      reportError(
        buildProviderErrorMessage(
          providerName,
          'Provider returned an empty completion payload (no text, no tool call, no token usage)',
          providerPayloadSnippet,
          isRemoteProvider
        )
      )
    }
    return null
  }

  LogHelper.title('LLM Provider')
  LogHelper.timeEnd(measureExecutionTimeLabel)

  return {
    dutyType: completionParams.dutyType,
    systemPrompt: completionParams.systemPrompt,
    temperature: completionParams.temperature,
    input:
      typeof promptOrChatHistory === 'string'
        ? promptOrChatHistory
        : safeSerialize(promptOrChatHistory),
    output: parseCompletionOutput(rawResultString, isJSONMode, completionParams),
    data: completionParams.data,
    maxTokens: completionParams.maxTokens,
    ...(typeof completionParams.thoughtTokensBudget === 'number'
      ? { thoughtTokensBudget: completionParams.thoughtTokensBudget }
      : {}),
    // Current used context size
    accounting,
    usedInputTokens,
    usedOutputTokens,
    generationDurationMs,
    ...(firstTokenAt !== undefined ? { firstTokenAt } : {}),
    ...(providerDecodeDurationMs ? { providerDecodeDurationMs } : {}),
    ...(providerTokensPerSecond ? { providerTokensPerSecond } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(reasoningItems?.length ? { reasoningItems } : {}),
    ...(finishReason ? { finishReason } : {}),
    ...(toolCalls ? { toolCalls } : {})
  }
}
