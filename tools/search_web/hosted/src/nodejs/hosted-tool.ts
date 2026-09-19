import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { generateText, stepCountIs, type LanguageModel, type ToolSet } from 'ai'

import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

const TOOLKIT_ID = 'search_web'
const TOOL_ID = 'hosted'
const DEFAULT_MAX_OUTPUT_TOKENS = 2_000
const MAX_SEARCH_STEPS = 3
const SEARCH_TIMEOUT_MS = 90_000
const SEARCH_RESULT_LIMIT = 5
const SEARCH_SYSTEM_PROMPT =
  'Search the web to answer the user request. Base the answer on retrieved sources and cite their URLs. Return a concise, direct answer.'
const DEFAULT_SETTINGS: Record<string, unknown> = {}

type HostedSearchProvider = 'openai' | 'anthropic' | 'deepseek' | 'openrouter'

interface HostedSearchOptions {
  provider?: 'auto' | HostedSearchProvider
  model?: string
  max_output_tokens?: number
  temperature?: number
}

interface HostedSearchResult {
  provider: HostedSearchProvider
  model: string
  content: string
  used_input_tokens?: number
  used_output_tokens?: number
}

interface ResolvedTarget {
  provider: HostedSearchProvider
  model: string
}

interface ModelTarget {
  provider: string
  model: string
}

/**
 * Searches through the active provider's server-executed web tool.
 */
export default class HostedTool extends Tool {
  private readonly config: ReturnType<typeof ToolkitConfig.load>

  constructor() {
    super()
    this.config = ToolkitConfig.load(TOOLKIT_ID, this.toolName)
    this.settings = ToolkitConfig.loadToolSettings(
      TOOLKIT_ID,
      this.toolName,
      DEFAULT_SETTINGS
    )
  }

  get toolName(): string {
    return TOOL_ID
  }

  get toolkit(): string {
    return TOOLKIT_ID
  }

  get description(): string {
    return this.config['description']
  }

  /**
   * Runs hosted web search using the selected provider and model.
   */
  async searchWeb(
    query: string,
    options?: HostedSearchOptions
  ): Promise<HostedSearchResult> {
    return this.searchWithProvider(
      query,
      this.resolveTarget(options?.provider || 'auto', options?.model),
      options
    )
  }

  /**
   * Runs hosted web search using the selected provider and model.
   */
  async searchOpenAI(
    query: string,
    options?: Omit<HostedSearchOptions, 'provider'>
  ): Promise<HostedSearchResult> {
    return this.searchWithProvider(
      query,
      this.resolveTarget('openai', options?.model),
      options
    )
  }

  /**
   * Runs hosted web search using the selected provider and model.
   */
  async searchAnthropic(
    query: string,
    options?: Omit<HostedSearchOptions, 'provider'>
  ): Promise<HostedSearchResult> {
    return this.searchWithProvider(
      query,
      this.resolveTarget('anthropic', options?.model),
      options
    )
  }

  private resolveTarget(
    requestedProvider: 'auto' | HostedSearchProvider,
    requestedModel?: string
  ): ResolvedTarget {
    if (requestedProvider !== 'auto') {
      return {
        provider: requestedProvider,
        model: this.resolveModel(requestedProvider, requestedModel)
      }
    }

    const activeTarget = this.getActiveLLMTarget()
    if (
      activeTarget &&
      this.isSupportedProvider(activeTarget.provider)
    ) {
      return {
        provider: activeTarget.provider,
        model: requestedModel || activeTarget.model
      }
    }

    throw new Error(
      'The active LLM provider does not support hosted search. Choose a supported provider from the searchWeb schema.'
    )
  }

  private async searchWithProvider(
    query: string,
    target: ResolvedTarget,
    options?: Omit<HostedSearchOptions, 'provider'>
  ): Promise<HostedSearchResult> {
    // generateText translates SDK tools into the provider's wire format and
    // resumes deferred server tools without introducing another agent loop.
    const result = await generateText({
      model: this.createLanguageModel(target),
      system: SEARCH_SYSTEM_PROMPT,
      prompt: query,
      maxOutputTokens: this.resolveMaxOutputTokens(options),
      // Leave model defaults intact unless the caller explicitly requests this.
      ...(typeof options?.temperature === 'number' &&
      Number.isFinite(options.temperature)
        ? { temperature: options.temperature }
        : {}),
      tools: { web_search: this.createHostedSearchTool(target.provider) },
      stopWhen: stepCountIs(MAX_SEARCH_STEPS),
      maxRetries: 0,
      abortSignal: this.createSearchSignal()
    })
    const content = result.text.trim()

    if (!content) {
      throw new Error(
        `Hosted search returned no text for ${target.provider}/${target.model}.`
      )
    }

    return {
      provider: target.provider,
      model: target.model,
      content,
      ...(typeof result.totalUsage.inputTokens === 'number'
        ? { used_input_tokens: result.totalUsage.inputTokens }
        : {}),
      ...(typeof result.totalUsage.outputTokens === 'number'
        ? { used_output_tokens: result.totalUsage.outputTokens }
        : {})
    }
  }

  private createLanguageModel(target: ResolvedTarget): LanguageModel {
    if (target.provider === 'openrouter') {
      return createOpenRouter({
        apiKey: this.readRequiredEnv('LEON_OPENROUTER_API_KEY')
      }).chat(target.model)
    }

    if (target.provider === 'openai') {
      const apiKey = this.readRequiredEnv('LEON_OPENAI_API_KEY')
      const provider = createOpenAI({
        apiKey,
        baseURL: 'https://api.openai.com/v1'
      })

      return provider.responses(target.model)
    }

    // DeepSeek exposes native search through its Anthropic-compatible API.
    // Its regular OpenAI-compatible chat endpoint does not provide this tool.
    const isDeepSeek = target.provider === 'deepseek'
    const apiKey = this.readRequiredEnv(
      isDeepSeek ? 'LEON_DEEPSEEK_API_KEY' : 'LEON_ANTHROPIC_API_KEY'
    )
    const provider = createAnthropic({
      apiKey,
      baseURL: isDeepSeek
        ? 'https://api.deepseek.com/anthropic/v1'
        : 'https://api.anthropic.com/v1'
    })

    return provider(target.model)
  }

  private createHostedSearchTool(
    providerName: HostedSearchProvider
  ): ToolSet[string] {
    if (providerName === 'openrouter') {
      return createOpenRouter().tools.webSearch({
        engine: 'auto',
        maxResults: SEARCH_RESULT_LIMIT
      })
    }
    if (providerName === 'openai') {
      const provider = createOpenAI()
      return provider.tools.webSearch()
    }

    const provider = createAnthropic()
    return provider.tools.webSearch_20250305({})
  }

  /**
   * Bounds provider calls and propagates cancellation from the owning tool run.
   */
  private createSearchSignal(): AbortSignal {
    const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS)
    const signal = this.executionContext?.signal
    return signal ? AbortSignal.any([signal, timeout]) : timeout
  }

  private resolveModel(
    providerName: HostedSearchProvider,
    requestedModel?: string
  ): string {
    if (requestedModel?.trim()) {
      return requestedModel.trim()
    }

    const activeTarget = this.getActiveLLMTarget()
    if (activeTarget?.provider === providerName && activeTarget.model) {
      return activeTarget.model
    }

    throw new Error(
      `No active .env LLM model is configured for hosted search provider "${providerName}". Use searchWeb with provider auto, configure LEON_AGENT_LLM/LEON_LLM with the same provider, or pass options.model.`
    )
  }

  private resolveMaxOutputTokens(
    options?: Omit<HostedSearchOptions, 'provider'>
  ): number {
    const value = options?.max_output_tokens

    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(1, Math.floor(value))
      : DEFAULT_MAX_OUTPUT_TOKENS
  }

  private getActiveLLMTarget(): ModelTarget | null {
    const rawTarget =
      process.env['LEON_AGENT_LLM'] ||
      process.env['LEON_LLM'] ||
      process.env['LEON_WORKFLOW_LLM'] ||
      ''

    return this.parseModelTarget(rawTarget)
  }

  private parseModelTarget(rawTarget: string): ModelTarget | null {
    const normalizedTarget = rawTarget.trim()
    const separatorIndex = normalizedTarget.indexOf('/')
    if (separatorIndex <= 0) {
      return null
    }

    const provider = normalizedTarget.slice(0, separatorIndex).trim()
    const model = normalizedTarget.slice(separatorIndex + 1).trim()
    if (!provider || !model) {
      return null
    }

    return {
      provider,
      model
    }
  }

  private isSupportedProvider(
    providerName: string
  ): providerName is HostedSearchProvider {
    return (
      providerName === 'openai' ||
      providerName === 'anthropic' ||
      providerName === 'deepseek' ||
      providerName === 'openrouter'
    )
  }

  private readRequiredEnv(key: string): string {
    const value = process.env[key]
    if (!value) {
      throw new Error(
        `${key} is not configured. Configure the regular LLM provider API key.`
      )
    }

    return value
  }
}
