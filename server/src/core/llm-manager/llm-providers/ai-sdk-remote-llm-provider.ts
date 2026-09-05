import type { AxiosResponse } from 'axios'
import type {
  JSONSchema7,
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4FunctionTool,
  LanguageModelV4Prompt,
  LanguageModelV4ToolChoice,
  SharedV4ProviderOptions
} from '@ai-sdk/provider'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createMoonshotAI } from '@ai-sdk/moonshotai'
import { createHuggingFace } from '@ai-sdk/huggingface'
import { createCerebras } from '@ai-sdk/cerebras'
import { createGroq } from '@ai-sdk/groq'
import { createWebSocketFetch } from '@vercel/ai-sdk-openai-websocket-fetch'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'

import { CONFIG_MANAGER } from '@/config'
import type {
  CompletionParams,
  LLMReasoningEffort,
  LLMReasoningMode,
  AgentToolTranscriptMessage,
  OpenAITool,
  OpenAIToolCall,
  OpenAIToolChoice,
  PromptOrChatHistory
} from '@/core/llm-manager/types'
import { LLMProviders } from '@/core/llm-manager/types'
import {
  canDisableLLMModelReasoning,
  getLLMModelCatalogEntry
} from '@/core/llm-manager/llm-model-catalog'
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

interface AISDKProviderOptionsContext {
  completionParams: CompletionParams
  reasoningMode: LLMReasoningMode | null
}

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
  transformRequestBody?: (args: Record<string, unknown>) => Record<string, unknown>
  buildProviderOptions?: (
    context: AISDKProviderOptionsContext
  ) => Record<string, unknown>
  shouldOmitTemperature?: (completionParams: CompletionParams) => boolean
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
  finishReason?: string
}

const STRUCTURED_OUTPUT_JSON_INSTRUCTION =
  'Return only valid JSON matching the requested schema.'

export default class AISDKRemoteLLMProvider {
  protected readonly name: string
  protected readonly apiKey: string | undefined
  protected readonly model: string

  private readonly config: AISDKRemoteProviderConfig
  private languageModel: LanguageModelV4
  private openAIWebSocketFetch:
    | ReturnType<typeof createWebSocketFetch>
    | undefined

  constructor(
    config: AISDKRemoteProviderConfig
  ) {
    this.config = config
    this.name = config.name
    this.apiKey = CONFIG_MANAGER.getProviderAPIKey(config.providerName)
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

  private createLanguageModel(): LanguageModelV4 {
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
        ...(this.config.transformRequestBody
          ? { transformRequestBody: this.config.transformRequestBody }
          : {}),
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
  private getLanguageModel(): LanguageModelV4 {
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
    completionParams: CompletionParams,
    requiresStructuredOutputInstruction = false
  ): LanguageModelV4Prompt {
    const normalizedSystemPrompt = [
      String(completionParams.systemPrompt ?? '').trim(),
      requiresStructuredOutputInstruction
        ? STRUCTURED_OUTPUT_JSON_INSTRUCTION
        : ''
    ]
      .filter(Boolean)
      .join('\n\n')
    const messages: LanguageModelV4Prompt = []

    if (normalizedSystemPrompt) {
      messages.push({
        role: 'system',
        content: normalizedSystemPrompt
      })
    }

    if (this.isAgentToolTranscript(prompt)) {
      messages.push(...this.toAgentToolMessages(prompt))
      return messages
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
    let lastMessageText = ''
    if (
      lastMessage &&
      (lastMessage.role === 'user' || lastMessage.role === 'assistant')
    ) {
      const firstContentPart = lastMessage.content[0]
      if (firstContentPart?.type === 'text') {
        lastMessageText = firstContentPart.text
      }
    }

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

  private isAgentToolTranscript(
    prompt: PromptOrChatHistory
  ): prompt is AgentToolTranscriptMessage[] {
    return (
      Array.isArray(prompt) &&
      prompt.length > 0 &&
      prompt.every((message) => {
        if (!message || typeof message !== 'object' || !('role' in message)) {
          return false
        }

        const candidate = message as Record<string, unknown>
        return (
          (candidate['role'] === 'user' ||
            candidate['role'] === 'assistant' ||
            candidate['role'] === 'tool') &&
          typeof candidate['content'] === 'string'
        )
      })
    )
  }

  /**
   * Converts Leon's canonical transcript into the AI SDK provider protocol.
   * Keeping this conversion at the provider boundary lets the agent loop retain
   * exact tool-call IDs without coupling orchestration to one API flavor.
   */
  private toAgentToolMessages(
    transcript: AgentToolTranscriptMessage[]
  ): LanguageModelV4Prompt {
    const messages: LanguageModelV4Prompt = []

    for (let index = 0; index < transcript.length; index += 1) {
      const message = transcript[index]!

      if (message.role === 'user') {
        messages.push({
          role: 'user',
          content: [{ type: 'text', text: message.content }]
        })
        continue
      }

      if (message.role === 'tool') {
        const toolResults: Extract<
          LanguageModelV4Prompt[number],
          { role: 'tool' }
        >['content'] = []
        const visualEvidence: Extract<
          LanguageModelV4Prompt[number],
          { role: 'user' }
        >['content'] = []

        // Keep every result from a parallel tool-call batch contiguous. Some
        // provider protocols reject a user message before all results arrive.
        while (index < transcript.length) {
          const toolMessage = transcript[index]!
          if (toolMessage.role !== 'tool') {
            index -= 1
            break
          }

          toolResults.push({
            type: 'tool-result',
            toolCallId: toolMessage.toolCallId,
            toolName: toolMessage.toolName,
            output: {
              type: 'text',
              value: toolMessage.content
            }
          })

          if (toolMessage.files?.length) {
            visualEvidence.push({
              type: 'text',
              text: `Visual evidence returned by ${toolMessage.toolName}.`
            })
            visualEvidence.push(
              ...toolMessage.files.map((file) => ({
                type: 'file' as const,
                data: {
                  type: 'data' as const,
                  data: file.dataBase64
                },
                mediaType: file.mediaType,
                ...(file.filename ? { filename: file.filename } : {}),
                ...this.getVisualFileProviderOptions(file.visualDetail)
              }))
            )
          }

          index += 1
        }

        messages.push({
          role: 'tool',
          content: toolResults
        })
        if (visualEvidence.length > 0) {
          // User-role image parts are the common multimodal input surface.
          // Tool-result image parts are not preserved by every compatible API.
          messages.push({ role: 'user', content: visualEvidence })
        }
        continue
      }

      const content: Extract<
        LanguageModelV4Prompt[number],
        { role: 'assistant' }
      >['content'] = []
      if (message.content.trim()) {
        content.push({ type: 'text', text: message.content })
      }
      for (const toolCall of message.toolCalls || []) {
        content.push({
          type: 'tool-call',
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          input: this.parseAgentToolInput(toolCall.function.arguments)
        })
      }

      messages.push({
        role: 'assistant',
        content
      })
    }

    return messages
  }

  private getVisualFileProviderOptions(
    visualDetail: 'auto' | 'low' | 'high' | undefined
  ): { providerOptions: SharedV4ProviderOptions } | Record<string, never> {
    if (!visualDetail || this.config.flavor !== 'openai-responses') {
      return {}
    }

    return {
      providerOptions: {
        openai: { imageDetail: visualDetail }
      }
    }
  }

  private parseAgentToolInput(input: string): unknown {
    try {
      return JSON.parse(input)
    } catch {
      // Some local chat templates require tool arguments to be objects. Keep
      // the raw model output available without making the recovery turn fail
      // before it can observe and correct the matching tool validation error.
      return {
        invalid_tool_arguments: true,
        raw_arguments: input
      }
    }
  }

  private normalizeSchema(
    schema: Record<string, unknown> | null | undefined
  ): JSONSchema7 | undefined {
    if (!schema) {
      return undefined
    }

    if ('type' in schema || 'oneOf' in schema) {
      return schema as JSONSchema7
    }

    return {
      type: 'object',
      properties: schema
    } as JSONSchema7
  }

  private toTools(
    tools: OpenAITool[] | undefined
  ): LanguageModelV4FunctionTool[] {
    if (!Array.isArray(tools) || tools.length === 0) {
      return []
    }

    return tools.map((tool) => ({
      type: 'function',
      name: tool.function.name,
      ...(tool.function.description
        ? { description: tool.function.description }
        : {}),
      inputSchema: tool.function.parameters as JSONSchema7,
      strict: false
    }))
  }

  private toToolChoice(
    toolChoice: OpenAIToolChoice | undefined
  ): LanguageModelV4ToolChoice | undefined {
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

  private getOpenAIReasoningEffort(
    reasoningMode: LLMReasoningMode,
    completionParams: CompletionParams
  ): LLMReasoningEffort {
    if (
      (reasoningMode === 'off' || completionParams.reasoningEffort === 'none') &&
      !canDisableLLMModelReasoning(LLMProviders.OpenAI, this.model)
    ) {
      return 'low'
    }

    if (completionParams.reasoningEffort) {
      return completionParams.reasoningEffort
    }

    if (reasoningMode === 'off') {
      return 'none'
    }

    return reasoningMode === 'guarded' ? 'low' : 'medium'
  }

  private buildOpenAICommonProviderOptions(
    completionParams: CompletionParams
  ): Record<string, unknown> {
    return {
      ...(completionParams.promptCacheKey
        ? { promptCacheKey: completionParams.promptCacheKey }
        : {}),
      ...(completionParams.promptCacheRetention
        ? { promptCacheRetention: completionParams.promptCacheRetention }
        : {}),
      ...(completionParams.textVerbosity
        ? { textVerbosity: completionParams.textVerbosity }
        : {}),
      ...(completionParams.serviceTier
        ? { serviceTier: completionParams.serviceTier }
        : {})
    }
  }

  private buildManagedProviderOptions(
    reasoningMode: LLMReasoningMode,
    completionParams: CompletionParams
  ): Record<string, unknown> {
    if (this.config.flavor === 'openai-responses') {
      return {
        openai: {
          ...this.buildOpenAICommonProviderOptions(completionParams),
          reasoningEffort: this.getOpenAIReasoningEffort(
            reasoningMode,
            completionParams
          ),
          ...(reasoningMode !== 'off' && completionParams.reasoningSummary
            ? { reasoningSummary: completionParams.reasoningSummary }
            : {})
        }
      }
    }

    if (this.config.flavor === 'openrouter') {
      // OpenRouter's equivalent of Fast Mode is provider routing optimized for
      // throughput, not an OpenAI-style service tier.
      const routing = completionParams.serviceTier === 'priority'
        ? { provider: { sort: 'throughput' } }
        : {}
      const catalogEntry = getLLMModelCatalogEntry(LLMProviders.OpenRouter, this.model)

      if (catalogEntry?.reasoning.includes('on')) {
        const enabled = reasoningMode !== 'off' &&
          completionParams.reasoningEffort !== 'none'
        const reasoningBudget = this.getReasoningBudget(completionParams)

        return {
          openrouter: {
            ...routing,
            reasoning: {
              enabled,
              ...(!enabled ? { exclude: true } : {}),
              ...(enabled && typeof reasoningBudget === 'number'
                ? { max_tokens: reasoningBudget }
                : {})
            }
          }
        }
      }

      if (reasoningMode === 'off' || completionParams.reasoningEffort === 'none') {
        const reasoning = canDisableLLMModelReasoning(
          LLMProviders.OpenRouter,
          this.model
        )
          ? {
              enabled: false,
              effort: 'none',
              exclude: true
            }
          : { effort: 'low' }

        return {
          openrouter: {
            ...routing,
            reasoning
          }
        }
      }

      if (reasoningMode === 'guarded') {
        return {
          openrouter: {
            ...routing,
            reasoning: {
              effort: completionParams.reasoningEffort || 'low'
            }
          }
        }
      }

      if (completionParams.reasoningUseDefaultEffort) {
        return {
          openrouter: {
            ...routing,
            reasoning: { enabled: true }
          }
        }
      }

      const reasoningBudget = this.getReasoningBudget(completionParams)
      // With no explicit effort, let the provider choose its model default.
      return {
        openrouter: {
          ...routing,
          reasoning: {
            ...(typeof reasoningBudget === 'number'
              ? { max_tokens: reasoningBudget }
              : completionParams.reasoningEffort
                ? { effort: completionParams.reasoningEffort }
                : { enabled: true })
          }
        }
      }
    }

    if (this.config.flavor === 'openai-compatible') {
      return {
        openaiCompatible: {
          ...(completionParams.reasoningEffort
            ? { reasoningEffort: completionParams.reasoningEffort }
            : {}),
          ...(completionParams.textVerbosity
            ? { textVerbosity: completionParams.textVerbosity }
            : {})
        }
      }
    }

    if (this.config.flavor === 'moonshotai') {
      if (this.model === 'kimi-k3') {
        // K3 always reasons and replaces K2's thinking object with a top-level
        // effort. Recovery uses its lowest supported level instead of "none".
        const reasoningEffort = reasoningMode === 'off' ||
          reasoningMode === 'guarded'
          ? 'low'
          : completionParams.reasoningEffort

        return reasoningEffort
          ? { moonshotai: { reasoningEffort } }
          : {}
      }

      if (!reasoningMode) {
        return {}
      }

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

      // K2's explicit thinking budget starts at 1,024 tokens, so guarded mode
      // falls back to disabled instead of forcing a large reasoning block.
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
            completionParams.reasoningEffort ||
            (reasoningMode === 'on' ? 'medium' : 'low')
        }
      }
    }

    if (this.config.flavor === 'cerebras') {
      return {
        cerebras: {
          reasoningEffort:
            completionParams.reasoningEffort ||
            (reasoningMode === 'on' ? 'medium' : 'low')
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
          reasoningEffort: completionParams.reasoningEffort ||
            (reasoningMode === 'guarded' ? 'low' : 'medium'),
          reasoningFormat: 'parsed'
        }
      }
    }

    return {}
  }

  private buildCallOptions(
    prompt: PromptOrChatHistory,
    completionParams: CompletionParams
  ): LanguageModelV4CallOptions {
    const catalogEntry = getLLMModelCatalogEntry(
      this.config.providerName as LLMProviders,
      this.model
    )
    const shouldOmitTemperature =
      catalogEntry?.supportsTemperature === false ||
      this.config.shouldOmitTemperature?.(completionParams) === true
    const normalizedSchema = this.normalizeSchema(completionParams.data)
    const options: LanguageModelV4CallOptions = {
      prompt: this.toTextPrompt(
        prompt,
        completionParams,
        Boolean(normalizedSchema)
      ),
      ...(completionParams.signal ? { abortSignal: completionParams.signal } : {}),
      ...(typeof completionParams.maxTokens === 'number'
        ? { maxOutputTokens: completionParams.maxTokens }
        : {}),
      ...(typeof completionParams.seed === 'number'
        ? { seed: completionParams.seed }
        : {}),
      ...(this.config.flavor !== 'moonshotai' &&
        !shouldOmitTemperature &&
        typeof completionParams.temperature === 'number'
        ? { temperature: completionParams.temperature }
        : {})
    }

    const tools = this.toTools(completionParams.tools)
    if (tools.length > 0) {
      options.tools = tools
    }

    const toolChoice = this.toToolChoice(completionParams.toolChoice)
    if (
      catalogEntry?.supportsForcedToolChoice === false &&
      (toolChoice?.type === 'required' || toolChoice?.type === 'tool')
    ) {
      throw new Error(
        `${this.model} does not support forced tool selection. Use toolChoice "auto" or "none".`
      )
    }
    if (toolChoice) {
      options.toolChoice = toolChoice
    }

    if (normalizedSchema) {
      options.responseFormat = {
        type: 'json',
        schema: normalizedSchema,
        name: 'structured_output'
      }
    }

    const providerOptions: Record<string, unknown> = {}
    const managedReasoningMode = this.resolveManagedReasoningMode(
      completionParams
    )
    const customProviderOptions = this.config.buildProviderOptions?.({
      completionParams,
      reasoningMode: managedReasoningMode
    })

    if (customProviderOptions) {
      Object.assign(providerOptions, customProviderOptions)
    } else if (catalogEntry?.reasoning.length === 1) {
      // Auto-only entries use the provider's reasoning defaults. Do not invent
      // an effort level for gateways with undocumented model-specific controls.
      if (
        this.config.flavor === 'openrouter' &&
        completionParams.serviceTier === 'priority'
      ) {
        providerOptions['openrouter'] = { provider: { sort: 'throughput' } }
      }
    } else if (managedReasoningMode) {
      Object.assign(
        providerOptions,
        this.buildManagedProviderOptions(managedReasoningMode, completionParams)
      )
    } else if (this.config.flavor === 'openai-responses') {
      const openAIOptions = this.buildOpenAICommonProviderOptions(
        completionParams
      )
      if (
        completionParams.disableThinking === true ||
        completionParams.reasoningEffort
      ) {
        providerOptions['openai'] = {
          ...openAIOptions,
          reasoningEffort: this.getOpenAIReasoningEffort(
            completionParams.disableThinking === true ? 'off' : 'on',
            completionParams
          )
        }
      } else {
        providerOptions['openai'] = {
          ...openAIOptions,
          ...(completionParams.reasoningSummary
            ? { reasoningSummary: completionParams.reasoningSummary }
            : {})
        }
      }
    } else if (this.config.flavor === 'openrouter') {
      const routing = completionParams.serviceTier === 'priority'
        ? { provider: { sort: 'throughput' } }
        : {}

      if (completionParams.disableThinking === true) {
        Object.assign(
          providerOptions,
          this.buildManagedProviderOptions('off', completionParams)
        )
      } else if (Object.keys(routing).length > 0) {
        providerOptions['openrouter'] = routing
      }
    } else if (this.config.flavor === 'openai-compatible') {
      if (completionParams.disableThinking === true) {
        providerOptions['openaiCompatible'] = {
          reasoningEffort: 'low',
          ...(completionParams.textVerbosity
            ? { textVerbosity: completionParams.textVerbosity }
            : {})
        }
      } else {
        providerOptions['openaiCompatible'] = {
          reasoningEffort: 'high',
          ...(completionParams.textVerbosity
            ? { textVerbosity: completionParams.textVerbosity }
            : {})
        }
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

    // OpenRouter's SDK omits tool_choice when the tool list is empty. Preserve
    // an explicit text-only request even if the transcript contains tool calls.
    if (this.config.flavor === 'openrouter' && toolChoice?.type === 'none') {
      providerOptions['openrouter'] = {
        ...(providerOptions['openrouter'] as Record<string, unknown> | undefined),
        tool_choice: 'none'
      }
    }

    if (Object.keys(providerOptions).length > 0) {
      options.providerOptions = providerOptions as SharedV4ProviderOptions
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

  private readFinishReason(finishReason: unknown): string | undefined {
    if (typeof finishReason === 'string') {
      return finishReason || undefined
    }

    if (!finishReason || typeof finishReason !== 'object') {
      return undefined
    }

    // Language Model V4 exposes both a provider-agnostic reason and the raw
    // provider value. Leon relies on the unified value for recovery decisions.
    const finishReasonObject = finishReason as Record<string, unknown>
    const unified = finishReasonObject['unified']
    if (typeof unified === 'string' && unified) {
      return unified
    }

    const raw = finishReasonObject['raw']
    return typeof raw === 'string' && raw ? raw : undefined
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
          ...(state.finishReason
            ? { finish_reason: state.finishReason }
            : {}),
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
    const result = await languageModel.doGenerate(callOptions)
    const content = result.content as Array<Record<string, unknown>>

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

    this.appendUsageFromUnknown(state, result.usage)
    this.appendProviderMetadataUsageFromUnknown(state, result.providerMetadata)
    const finishReason = this.readFinishReason(result.finishReason)
    if (finishReason) {
      state.finishReason = finishReason
    }

    return this.buildOpenAICompatiblePayload(state)
  }

  private async runStreamingCompletion(
    prompt: PromptOrChatHistory,
    completionParams: CompletionParams
  ): Promise<Record<string, unknown>> {
    const state = this.createCallState()
    const callOptions = this.buildCallOptions(prompt, completionParams)
    const languageModel = this.getLanguageModel()
    const result = await languageModel.doStream(callOptions)

    // Signal streaming as soon as we receive a stream object, even if the
    // model emits only tool-call deltas and no text tokens.
    completionParams.onToken?.('')

    for await (const streamPart of result.stream) {
      const part = streamPart as unknown as Record<string, unknown>
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
        const finishReason =
          this.readFinishReason(part['finishReason']) ||
          readString(part['rawFinishReason'])
        if (finishReason) {
          state.finishReason = finishReason
        }
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
