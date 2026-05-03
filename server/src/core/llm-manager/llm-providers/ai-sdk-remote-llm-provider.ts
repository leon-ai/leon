import type { AxiosResponse } from 'axios'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createMoonshotAI } from '@ai-sdk/moonshotai'
import { createHuggingFace } from '@ai-sdk/huggingface'
import { createCerebras } from '@ai-sdk/cerebras'
import { createGroq } from '@ai-sdk/groq'
import { createWebSocketFetch } from '@vercel/ai-sdk-openai-websocket-fetch'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'

import type {
  CompletionParams,
  LLMReasoningMode,
  OpenAITool,
  OpenAIToolCall,
  OpenAIToolChoice,
  PromptOrChatHistory
} from '@/core/llm-manager/types'
import { mergeStreamingChunk } from '@/core/llm-manager/streaming-chunk'
import { LogHelper } from '@/helpers/log-helper'

type AISDKFlavor =
  | 'openai-responses'
  | 'openrouter'
  | 'openai-compatible'
  | 'anthropic'
  | 'moonshotai'
  | 'huggingface'
  | 'cerebras'
  | 'groq'

interface AISDKRemoteProviderConfig {
  name: string
  providerName: string
  apiKeyEnv: string
  model: string
  baseURL: string
  flavor: AISDKFlavor
  requiresApiKey?: boolean
  sendApiKeyAsBearer?: boolean
  headers?: (apiKey: string) => Record<string, string>
}

interface CallState {
  text: string
  reasoning: string
  toolCallsById: Record<
    string,
    {
      id: string
      functionName: string
      arguments: string
    }
  >
  toolCallOrder: string[]
  usedInputTokens: number
  usedOutputTokens: number
}

export default class AISDKRemoteLLMProvider {
  protected readonly name: string
  protected readonly apiKey: string | undefined
  protected readonly model: string

  private readonly config: AISDKRemoteProviderConfig
  private languageModel: unknown
  private openAIWebSocketFetch:
    | ReturnType<typeof createWebSocketFetch>
    | undefined

  constructor(
    config: AISDKRemoteProviderConfig
  ) {
    this.config = config
    this.name = config.name
    this.apiKey = process.env[config.apiKeyEnv]
    this.model = config.model

    LogHelper.title(this.name)
    LogHelper.success('New instance')

    this.checkAPIKey()
    this.languageModel = this.createLanguageModel()
  }

  public get modelName(): string {
    return this.model
  }

  public dispose(): void {
    this.openAIWebSocketFetch?.close()
  }

  protected setBaseURL(baseURL: string): void {
    if (this.config.baseURL === baseURL) {
      return
    }

    this.config.baseURL = baseURL
    this.openAIWebSocketFetch?.close()
    this.openAIWebSocketFetch = undefined
    this.languageModel = this.createLanguageModel()
  }

  private checkAPIKey(): void {
    if (this.config.requiresApiKey === false) {
      return
    }

    if (!this.apiKey || this.apiKey === '') {
      LogHelper.title(this.name)

      const errorMessage = `${this.name} API key is not defined. Please define it in the .env file`
      LogHelper.error(errorMessage)
      throw new Error(errorMessage)
    }
  }

  private createLanguageModel(): unknown {
    const apiKey = this.apiKey || ''
    const headers = this.config.headers?.(apiKey)

    if (this.config.flavor === 'openai-responses') {
      const fetch = this.getOpenAIWebSocketFetch()
      const provider = createOpenAI({
        apiKey,
        baseURL: this.config.baseURL,
        fetch,
        ...(headers && Object.keys(headers).length > 0 ? { headers } : {})
      })

      return provider.responses(this.model)
    }

    if (this.config.flavor === 'openai-compatible') {
      const provider = createOpenAICompatible({
        name: this.config.providerName,
        baseURL: this.config.baseURL,
        includeUsage: true,
        ...(
          this.config.sendApiKeyAsBearer === false || !apiKey
            ? {}
            : { apiKey }
        ),
        ...(headers && Object.keys(headers).length > 0 ? { headers } : {})
      })

      return provider(this.model)
    }

    if (this.config.flavor === 'openrouter') {
      const provider = createOpenRouter({
        apiKey,
        baseURL: this.config.baseURL,
        compatibility: 'strict',
        ...(headers && Object.keys(headers).length > 0 ? { headers } : {})
      })

      return provider.chat(this.model, {
        usage: {
          include: true
        }
      })
    }

    if (this.config.flavor === 'anthropic') {
      const provider = createAnthropic({
        apiKey,
        baseURL: this.config.baseURL,
        ...(headers && Object.keys(headers).length > 0 ? { headers } : {})
      })

      return provider(this.model)
    }

    if (this.config.flavor === 'moonshotai') {
      const provider = createMoonshotAI({
        apiKey,
        baseURL: this.config.baseURL,
        ...(headers && Object.keys(headers).length > 0 ? { headers } : {})
      })

      return provider(this.model)
    }

    if (this.config.flavor === 'huggingface') {
      const provider = createHuggingFace({
        apiKey,
        baseURL: this.config.baseURL,
        ...(headers && Object.keys(headers).length > 0 ? { headers } : {})
      })

      return provider(this.model)
    }

    if (this.config.flavor === 'cerebras') {
      const provider = createCerebras({
        apiKey,
        baseURL: this.config.baseURL,
        ...(headers && Object.keys(headers).length > 0 ? { headers } : {})
      })

      return provider(this.model)
    }

    if (this.config.flavor === 'groq') {
      const provider = createGroq({
        apiKey,
        baseURL: this.config.baseURL,
        ...(headers && Object.keys(headers).length > 0 ? { headers } : {})
      })

      return provider(this.model)
    }

    throw new Error(`Unsupported AI SDK flavor: ${this.config.flavor}`)
  }
  private getLanguageModel(): unknown {
    return this.languageModel
  }

  private getOpenAIWebSocketFetch(): ReturnType<typeof createWebSocketFetch> {
    if (!this.openAIWebSocketFetch) {
      this.openAIWebSocketFetch = createWebSocketFetch({
        url: this.toOpenAIResponsesWebSocketURL(this.config.baseURL)
      })
    }

    return this.openAIWebSocketFetch
  }

  private toOpenAIResponsesWebSocketURL(baseURL: string): string {
    const url = new URL(baseURL)
    const normalizedBasePath = url.pathname.endsWith('/')
      ? url.pathname
      : `${url.pathname}/`

    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.pathname = new URL('responses', `http://localhost${normalizedBasePath}`)
      .pathname
    url.search = ''
    url.hash = ''

    return url.toString()
  }

  private toTextPrompt(
    prompt: PromptOrChatHistory,
    completionParams: CompletionParams
  ): Array<Record<string, unknown>> {
    const normalizedSystemPrompt = String(completionParams.systemPrompt ?? '')
      .trim()
    const messages: Array<Record<string, unknown>> = []

    if (normalizedSystemPrompt) {
      messages.push({
        role: 'system',
        content: normalizedSystemPrompt
      })
    }

    if (completionParams.history) {
      for (const message of completionParams.history) {
        messages.push({
          role: message.who === 'leon' ? 'assistant' : 'user',
          content: [
            {
              type: 'text',
              text: message.message
            }
          ]
        })
      }
    }

    const promptText =
      typeof prompt === 'string' ? prompt : JSON.stringify(prompt)
    const lastMessage = messages[messages.length - 1]
    const lastMessageText =
      lastMessage &&
      Array.isArray(lastMessage['content']) &&
      lastMessage['content'][0] &&
      typeof lastMessage['content'][0] === 'object' &&
      typeof (lastMessage['content'][0] as Record<string, unknown>)['text'] ===
        'string'
        ? ((lastMessage['content'][0] as Record<string, unknown>)['text'] as string)
        : ''

    if (!lastMessage || lastMessageText !== promptText) {
      messages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: promptText
          }
        ]
      })
    }

    return messages
  }

  private normalizeSchema(
    schema: Record<string, unknown> | null | undefined
  ): Record<string, unknown> | undefined {
    if (!schema) {
      return undefined
    }

    if ('type' in schema || 'oneOf' in schema) {
      return schema
    }

    return {
      type: 'object',
      properties: schema
    }
  }

  private toTools(tools: OpenAITool[] | undefined): Array<Record<string, unknown>> {
    if (!Array.isArray(tools) || tools.length === 0) {
      return []
    }

    return tools.map((tool) => ({
      type: 'function',
      name: tool.function.name,
      ...(tool.function.description
        ? { description: tool.function.description }
        : {}),
      inputSchema: tool.function.parameters as Record<string, unknown>,
      strict: false
    }))
  }

  private toToolChoice(
    toolChoice: OpenAIToolChoice | undefined
  ): Record<string, unknown> | undefined {
    if (!toolChoice) {
      return undefined
    }

    if (typeof toolChoice === 'string') {
      if (toolChoice === 'auto' || toolChoice === 'required' || toolChoice === 'none') {
        return { type: toolChoice }
      }

      return undefined
    }

    return {
      type: 'tool',
      toolName: toolChoice.function.name
    }
  }

  private resolveManagedReasoningMode(
    completionParams: CompletionParams
  ): LLMReasoningMode | null {
    if (!completionParams.reasoningMode) {
      return null
    }

    return completionParams.disableThinking === true
      ? 'off'
      : completionParams.reasoningMode
  }

  private getReasoningBudget(
    completionParams: CompletionParams,
    minimum = 0
  ): number | null {
    const budget = completionParams.thoughtTokensBudget
    if (typeof budget !== 'number' || !Number.isFinite(budget)) {
      return minimum > 0 ? minimum : null
    }

    return Math.max(minimum, Math.floor(budget))
  }

  private buildManagedProviderOptions(
    reasoningMode: LLMReasoningMode,
    completionParams: CompletionParams
  ): Record<string, unknown> {
    if (this.config.flavor === 'openai-responses') {
      if (reasoningMode === 'off') {
        return {
          openai: {
            reasoningEffort: 'low'
          }
        }
      }

      return {
        openai: {
          reasoningEffort: reasoningMode === 'guarded' ? 'low' : 'medium',
          reasoningSummary: 'detailed'
        }
      }
    }

    if (this.config.flavor === 'openrouter') {
      if (reasoningMode === 'off') {
        return {
          openrouter: {
            reasoning: {
              enabled: false,
              effort: 'none',
              exclude: true
            }
          }
        }
      }

      if (reasoningMode === 'guarded') {
        return {
          openrouter: {
            reasoning: {
              effort: 'low'
            }
          }
        }
      }

      const reasoningBudget = this.getReasoningBudget(completionParams)
      return {
        openrouter: {
          reasoning: {
            ...(typeof reasoningBudget === 'number'
              ? { max_tokens: reasoningBudget }
              : { effort: 'high' })
          }
        }
      }
    }

    if (this.config.flavor === 'openai-compatible') {
      return {}
    }

    if (this.config.flavor === 'anthropic') {
      if (reasoningMode === 'on') {
        const reasoningBudget = this.getReasoningBudget(
          completionParams,
          1024
        )
        return {
          anthropic: {
            thinking: {
              type: 'enabled',
              ...(typeof reasoningBudget === 'number'
                ? { budgetTokens: reasoningBudget }
                : {})
            },
            sendReasoning: true
          }
        }
      }

      return {
        anthropic: {
          thinking: { type: 'disabled' },
          sendReasoning: true
        }
      }
    }

    if (this.config.flavor === 'moonshotai') {
      if (reasoningMode === 'on') {
        const reasoningBudget = this.getReasoningBudget(
          completionParams,
          1024
        )
        return {
          moonshotai: {
            thinking: {
              type: 'enabled',
              ...(typeof reasoningBudget === 'number'
                ? { budgetTokens: reasoningBudget }
                : {})
            },
            reasoningHistory: 'interleaved'
          }
        }
      }

      // Moonshot's explicit thinking budget starts at 1024 tokens, so guarded
      // mode falls back to disabled instead of forcing a large reasoning block.
      return {
        moonshotai: {
          thinking: { type: 'disabled' },
          reasoningHistory: 'disabled'
        }
      }
    }

    if (this.config.flavor === 'huggingface') {
      return {
        huggingface: {
          reasoningEffort:
            reasoningMode === 'on'
              ? 'medium'
              : 'low'
        }
      }
    }

    if (this.config.flavor === 'cerebras') {
      return {
        cerebras: {
          reasoningEffort:
            reasoningMode === 'on'
              ? 'medium'
              : 'low'
        }
      }
    }

    if (this.config.flavor === 'groq') {
      if (reasoningMode === 'off') {
        return {
          groq: {
            reasoningEffort: 'none',
            reasoningFormat: 'hidden'
          }
        }
      }

      return {
        groq: {
          reasoningEffort: reasoningMode === 'guarded' ? 'low' : 'medium',
          reasoningFormat: 'parsed'
        }
      }
    }

    return {}
  }

  private buildCallOptions(
    prompt: PromptOrChatHistory,
    completionParams: CompletionParams
  ): Record<string, unknown> {
    const options: Record<string, unknown> = {
      prompt: this.toTextPrompt(prompt, completionParams),
      ...(completionParams.signal ? { abortSignal: completionParams.signal } : {}),
      ...(typeof completionParams.maxTokens === 'number'
        ? { maxOutputTokens: completionParams.maxTokens }
        : {}),
      ...(this.config.flavor !== 'moonshotai' &&
        typeof completionParams.temperature === 'number'
        ? { temperature: completionParams.temperature }
        : {})
    }

    const tools = this.toTools(completionParams.tools)
    if (tools.length > 0) {
      options['tools'] = tools
    }

    const toolChoice = this.toToolChoice(completionParams.toolChoice)
    if (toolChoice) {
      options['toolChoice'] = toolChoice
    }

    const normalizedSchema = this.normalizeSchema(completionParams.data)
    if (normalizedSchema) {
      options['responseFormat'] = {
        type: 'json',
        schema: normalizedSchema,
        name: 'structured_output'
      }
    }

    const providerOptions: Record<string, unknown> = {}
    const managedReasoningMode = this.resolveManagedReasoningMode(
      completionParams
    )

    if (managedReasoningMode) {
      Object.assign(
        providerOptions,
        this.buildManagedProviderOptions(managedReasoningMode, completionParams)
      )
    } else if (this.config.flavor === 'openai-responses') {
      if (completionParams.disableThinking === true) {
        providerOptions['openai'] = {
          reasoningEffort: 'low'
        }
      } else {
        // For OpenAI Responses models, request reasoning summaries so planning
        // and recovery reasoning is visible in stream.
        providerOptions['openai'] = {
          reasoningSummary: 'detailed'
        }
      }
    } else if (this.config.flavor === 'openrouter') {
      if (completionParams.disableThinking === true) {
        providerOptions['openrouter'] = {
          reasoning: {
            enabled: false,
            effort: 'none',
            exclude: true
          }
        }
      }
    } else if (this.config.flavor === 'openai-compatible') {
      if (completionParams.disableThinking === true) {
        providerOptions['openaiCompatible'] = {
          reasoningEffort: 'low'
        }
      } else {
        providerOptions['openaiCompatible'] = {
          reasoningEffort: 'high'
        }
      }
    } else if (this.config.flavor === 'anthropic') {
      providerOptions['anthropic'] = completionParams.disableThinking === true
        ? {
            thinking: { type: 'disabled' },
            sendReasoning: true
          }
        : {
            thinking: { type: 'enabled' },
            sendReasoning: true
          }
    } else if (this.config.flavor === 'moonshotai') {
      providerOptions['moonshotai'] = completionParams.disableThinking === true
        ? {
            thinking: { type: 'disabled' }
          }
        : {
            thinking: { type: 'enabled' },
            reasoningHistory: 'interleaved'
          }
    } else if (this.config.flavor === 'huggingface') {
      providerOptions['huggingface'] = completionParams.disableThinking === true
        ? {
            reasoningEffort: 'low'
          }
        : {
            reasoningEffort: 'high'
          }
    } else if (this.config.flavor === 'cerebras') {
      providerOptions['cerebras'] = completionParams.disableThinking === true
        ? {
            reasoningEffort: 'low'
          }
        : {
            reasoningEffort: 'high'
          }
    } else if (this.config.flavor === 'groq') {
      providerOptions['groq'] = completionParams.disableThinking === true
        ? {
            reasoningEffort: 'none',
            reasoningFormat: 'hidden'
          }
        : {
            reasoningEffort: 'medium',
            reasoningFormat: 'parsed'
          }
    }

    if (Object.keys(providerOptions).length > 0) {
      options['providerOptions'] = providerOptions
    }

    return options
  }

  private ensureToolCall(state: CallState, toolCallId: string): void {
    if (!state.toolCallsById[toolCallId]) {
      state.toolCallsById[toolCallId] = {
        id: toolCallId,
        functionName: '',
        arguments: ''
      }
      state.toolCallOrder.push(toolCallId)
    }
  }

  private createCallState(): CallState {
    return {
      text: '',
      reasoning: '',
      toolCallsById: {},
      toolCallOrder: [],
      usedInputTokens: 0,
      usedOutputTokens: 0
    }
  }

  private appendUsageFromUnknown(state: CallState, usage: unknown): void {
    if (!usage || typeof usage !== 'object') {
      return
    }

    const usageObject = usage as Record<string, unknown>
    const readTokenCount = (value: unknown): number | undefined => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value
      }
      if (value && typeof value === 'object') {
        const objectValue = value as Record<string, unknown>
        const total = objectValue['total']
        if (typeof total === 'number' && Number.isFinite(total)) {
          return total
        }
      }

      return undefined
    }

    const inputTokens =
      readTokenCount(usageObject['inputTokens']) ??
      readTokenCount(usageObject['input_tokens']) ??
      readTokenCount(usageObject['promptTokens']) ??
      readTokenCount(usageObject['prompt_tokens'])
    const outputTokens =
      readTokenCount(usageObject['outputTokens']) ??
      readTokenCount(usageObject['output_tokens']) ??
      readTokenCount(usageObject['completionTokens']) ??
      readTokenCount(usageObject['completion_tokens'])

    if (typeof inputTokens === 'number' && Number.isFinite(inputTokens)) {
      state.usedInputTokens = inputTokens
    }
    if (typeof outputTokens === 'number' && Number.isFinite(outputTokens)) {
      state.usedOutputTokens = outputTokens
    }
  }

  private appendProviderMetadataUsageFromUnknown(
    state: CallState,
    providerMetadata: unknown
  ): void {
    if (!providerMetadata || typeof providerMetadata !== 'object') {
      return
    }

    const providerMetadataObject = providerMetadata as Record<string, unknown>

    if (
      providerMetadataObject['openrouter'] &&
      typeof providerMetadataObject['openrouter'] === 'object'
    ) {
      const openrouterMetadata = providerMetadataObject['openrouter'] as Record<
        string,
        unknown
      >
      this.appendUsageFromUnknown(state, openrouterMetadata['usage'])
    }
  }

  private serializeStreamError(error: unknown): string {
    if (error instanceof Error) {
      return error.message
    }

    if (typeof error === 'string') {
      return error
    }

    if (!error || typeof error !== 'object') {
      return String(error)
    }

    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }

  private createStreamError(error: unknown): Error {
    if (error instanceof Error) {
      return error
    }

    const streamError = new Error(this.serializeStreamError(error))

    if (error && typeof error === 'object') {
      const errorObject = error as Record<string, unknown>
      const streamErrorWithMetadata = streamError as Error & {
        status?: number
        statusCode?: number
        cause?: unknown
      }

      if (typeof errorObject['name'] === 'string') {
        streamError.name = errorObject['name'] as string
      }
      if (typeof errorObject['statusCode'] === 'number') {
        streamErrorWithMetadata.statusCode = errorObject['statusCode'] as number
      }
      if (typeof errorObject['status'] === 'number') {
        streamErrorWithMetadata.status = errorObject['status'] as number
      }
      streamErrorWithMetadata.cause = error
    }

    return streamError
  }

  private buildOpenAICompatiblePayload(
    state: CallState
  ): Record<string, unknown> {
    const toolCalls: OpenAIToolCall[] = state.toolCallOrder
      .map((toolCallId, index) => {
        const call = state.toolCallsById[toolCallId]
        if (!call) {
          return null
        }

        return {
          id: call.id || `tool_call_${index}`,
          type: 'function',
          function: {
            name: call.functionName,
            arguments: call.arguments || '{}'
          }
        } satisfies OpenAIToolCall
      })
      .filter(
        (toolCall): toolCall is OpenAIToolCall =>
          !!toolCall && toolCall.function.name.trim().length > 0
      )

    return {
      choices: [
        {
          message: {
            content: state.text,
            ...(state.reasoning.trim().length > 0
              ? { reasoning: state.reasoning.trim() }
              : {}),
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
          }
        }
      ],
      usage: {
        prompt_tokens: state.usedInputTokens,
        completion_tokens: state.usedOutputTokens
      }
    }
  }

  private async runNonStreamingCompletion(
    prompt: PromptOrChatHistory,
    completionParams: CompletionParams
  ): Promise<Record<string, unknown>> {
    const state = this.createCallState()
    const callOptions = this.buildCallOptions(prompt, completionParams)
    const languageModel = this.getLanguageModel()
    const result = await (
      languageModel as {
        doGenerate: (
          options: Record<string, unknown>
        ) => Promise<Record<string, unknown>>
      }
    ).doGenerate(callOptions)

    const content = Array.isArray(result['content'])
      ? (result['content'] as Array<Record<string, unknown>>)
      : []

    for (const part of content) {
      const type = typeof part['type'] === 'string' ? (part['type'] as string) : ''
      if (type === 'text' && typeof part['text'] === 'string') {
        state.text += part['text'] as string
        continue
      }

      if (type === 'reasoning' && typeof part['text'] === 'string') {
        state.reasoning += part['text'] as string
        continue
      }

      if (type === 'tool-call') {
        const toolCallId =
          typeof part['toolCallId'] === 'string'
            ? (part['toolCallId'] as string)
            : `tool_call_${state.toolCallOrder.length}`
        const toolName =
          typeof part['toolName'] === 'string' ? (part['toolName'] as string) : ''
        const input =
          typeof part['input'] === 'string'
            ? (part['input'] as string)
            : JSON.stringify(part['input'] ?? {})

        this.ensureToolCall(state, toolCallId)
        state.toolCallsById[toolCallId]!.functionName = toolName
        state.toolCallsById[toolCallId]!.arguments = input
      }
    }

    this.appendUsageFromUnknown(state, result['usage'])
    this.appendProviderMetadataUsageFromUnknown(state, result['providerMetadata'])

    return this.buildOpenAICompatiblePayload(state)
  }

  private async runStreamingCompletion(
    prompt: PromptOrChatHistory,
    completionParams: CompletionParams
  ): Promise<Record<string, unknown>> {
    const state = this.createCallState()
    const callOptions = this.buildCallOptions(prompt, completionParams)
    const languageModel = this.getLanguageModel()
    const result = await (
      languageModel as {
        doStream: (
          options: Record<string, unknown>
        ) => Promise<{
          stream: AsyncIterable<Record<string, unknown>>
          response?: unknown
        }>
      }
    ).doStream(callOptions)

    // Signal streaming as soon as we receive a stream object, even if the
    // model emits only tool-call deltas and no text tokens.
    completionParams.onToken?.('')

    for await (const part of result.stream) {
      const type = typeof part['type'] === 'string' ? (part['type'] as string) : ''

      const readString = (...values: unknown[]): string => {
        for (const value of values) {
          if (typeof value === 'string') {
            return value
          }
        }
        return ''
      }

      if (type === 'text-delta') {
        const delta = readString(part['delta'], part['textDelta'], part['text'])
        if (!delta) {
          continue
        }
        state.text += delta
        completionParams.onToken?.(delta)
        continue
      }

      if (type === 'text') {
        const delta = readString(part['delta'], part['textDelta'], part['text'])
        if (!delta) {
          continue
        }
        const mergedDelta = mergeStreamingChunk(state.text, delta)
        if (!mergedDelta) {
          continue
        }
        state.text += mergedDelta
        completionParams.onToken?.(mergedDelta)
        continue
      }

      if (type === 'reasoning-delta' || type === 'reasoning') {
        const delta = readString(part['delta'], part['textDelta'], part['text'])
        if (!delta) {
          continue
        }
        const mergedDelta = mergeStreamingChunk(state.reasoning, delta)
        if (!mergedDelta) {
          continue
        }
        state.reasoning += mergedDelta
        completionParams.onReasoningToken?.(mergedDelta)
        continue
      }

      if (type === 'tool-call') {
        const toolCallId =
          typeof part['toolCallId'] === 'string'
            ? (part['toolCallId'] as string)
            : typeof part['id'] === 'string'
              ? (part['id'] as string)
              : `tool_call_${state.toolCallOrder.length}`
        const toolName =
          readString(part['toolName'], part['name'])
        const rawInput = part['input']
        const input =
          typeof rawInput === 'string'
            ? rawInput
            : JSON.stringify(
                rawInput ??
                  (typeof part['arguments'] === 'string'
                    ? part['arguments']
                    : {})
              )

        this.ensureToolCall(state, toolCallId)
        state.toolCallsById[toolCallId]!.functionName = toolName
        state.toolCallsById[toolCallId]!.arguments = input
        continue
      }

      if (type === 'tool-input-start') {
        const toolCallId =
          typeof part['id'] === 'string'
            ? (part['id'] as string)
            : `tool_call_${state.toolCallOrder.length}`
        const toolName =
          typeof part['toolName'] === 'string' ? (part['toolName'] as string) : ''

        this.ensureToolCall(state, toolCallId)
        if (toolName) {
          state.toolCallsById[toolCallId]!.functionName = toolName
        }
        continue
      }

      if (type === 'tool-input-delta') {
        const toolCallId =
          typeof part['id'] === 'string'
            ? (part['id'] as string)
            : `tool_call_${state.toolCallOrder.length}`
        const delta = readString(
          part['delta'],
          part['inputTextDelta'],
          part['argsTextDelta']
        )

        this.ensureToolCall(state, toolCallId)
        state.toolCallsById[toolCallId]!.arguments += delta
        continue
      }

      if (type === 'tool-call-delta') {
        const toolCallId =
          typeof part['toolCallId'] === 'string'
            ? (part['toolCallId'] as string)
            : typeof part['id'] === 'string'
              ? (part['id'] as string)
              : `tool_call_${state.toolCallOrder.length}`
        const toolName = readString(part['toolName'], part['name'])
        const delta =
          readString(part['argsTextDelta'], part['inputTextDelta'], part['delta'])

        this.ensureToolCall(state, toolCallId)
        if (toolName) {
          state.toolCallsById[toolCallId]!.functionName = toolName
        }
        if (delta) {
          state.toolCallsById[toolCallId]!.arguments += delta
        }
        continue
      }

      if (type === 'finish' || type === 'finish-step') {
        this.appendUsageFromUnknown(state, part['usage'])
        this.appendProviderMetadataUsageFromUnknown(
          state,
          part['providerMetadata']
        )
        continue
      }

      if (type === 'error') {
        throw this.createStreamError(part['error'])
      }
    }

    return this.buildOpenAICompatiblePayload(state)
  }

  public runChatCompletion(
    prompt: PromptOrChatHistory,
    completionParams: CompletionParams
  ): Promise<AxiosResponse> {
    this.checkAPIKey()

    return (completionParams.shouldStream === true
      ? this.runStreamingCompletion(prompt, completionParams)
      : this.runNonStreamingCompletion(prompt, completionParams)
    ).then((responseData) => ({
      data: responseData
    })) as Promise<AxiosResponse>
  }
}
