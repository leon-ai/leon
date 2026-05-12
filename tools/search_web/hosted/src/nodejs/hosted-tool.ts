import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'

import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

const TOOLKIT_ID = 'search_web'
const TOOL_ID = 'hosted'
const DEFAULT_MAX_OUTPUT_TOKENS = 2_000
const DEFAULT_TEMPERATURE = 0.2
const DEFAULT_SETTINGS: Record<string, unknown> = {}

type HostedSearchProvider = 'openai' | 'anthropic'

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

interface GenerationState {
  text: string
  usedInputTokens?: number
  usedOutputTokens?: number
}

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
      'The active LLM provider does not support hosted search. Choose provider openai or anthropic.'
    )
  }

  private async searchWithProvider(
    query: string,
    target: ResolvedTarget,
    options?: Omit<HostedSearchOptions, 'provider'>
  ): Promise<HostedSearchResult> {
    const state = await this.runHostedSearch(query, target, options)
    const content = state.text.trim()

    if (!content) {
      throw new Error(
        `Hosted search returned no text for ${target.provider}/${target.model}.`
      )
    }

    return {
      provider: target.provider,
      model: target.model,
      content,
      ...(typeof state.usedInputTokens === 'number'
        ? { used_input_tokens: state.usedInputTokens }
        : {}),
      ...(typeof state.usedOutputTokens === 'number'
        ? { used_output_tokens: state.usedOutputTokens }
        : {})
    }
  }

  private async runHostedSearch(
    query: string,
    target: ResolvedTarget,
    options?: Omit<HostedSearchOptions, 'provider'>
  ): Promise<GenerationState> {
    const maxOutputTokens = this.resolveMaxOutputTokens(options)
    const temperature = this.resolveTemperature(options)
    const callOptions: Record<string, unknown> = {
      prompt: this.toPrompt(query),
      maxOutputTokens,
      temperature,
      tools: [this.createHostedSearchTool(target.provider)]
    }
    const languageModel = this.createLanguageModel(target)
    const result = await (
      languageModel as {
        doGenerate: (
          options: Record<string, unknown>
        ) => Promise<Record<string, unknown>>
      }
    ).doGenerate(callOptions)

    return this.extractGenerationState(result)
  }

  private createLanguageModel(target: ResolvedTarget): unknown {
    if (target.provider === 'openai') {
      const apiKey = this.readRequiredEnv('LEON_OPENAI_API_KEY')
      const provider = createOpenAI({
        apiKey,
        baseURL: 'https://api.openai.com/v1'
      })

      return provider.responses(target.model)
    }

    const apiKey = this.readRequiredEnv('LEON_ANTHROPIC_API_KEY')
    const provider = createAnthropic({
      apiKey,
      baseURL: 'https://api.anthropic.com/v1'
    })

    return provider(target.model)
  }

  private createHostedSearchTool(
    providerName: HostedSearchProvider
  ): Record<string, unknown> {
    if (providerName === 'openai') {
      const provider = createOpenAI()
      return provider.tools.webSearch() as unknown as Record<string, unknown>
    }

    const provider = createAnthropic()
    return provider.tools.webSearch_20250305({}) as unknown as Record<
      string,
      unknown
    >
  }

  private toPrompt(query: string): Array<Record<string, unknown>> {
    return [
      {
        role: 'system',
        content:
          'Answer the user request using hosted web search when current public information is needed. Return a concise, direct answer. Do not mention internal tool usage.'
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: query
          }
        ]
      }
    ]
  }

  private extractGenerationState(result: Record<string, unknown>): GenerationState {
    const state: GenerationState = {
      text: ''
    }
    const content = Array.isArray(result['content'])
      ? (result['content'] as Array<Record<string, unknown>>)
      : []

    for (const part of content) {
      if (part['type'] === 'text' && typeof part['text'] === 'string') {
        state.text += part['text']
      }
    }

    this.appendUsage(state, result['usage'])

    return state
  }

  private appendUsage(state: GenerationState, usage: unknown): void {
    if (!usage || typeof usage !== 'object') {
      return
    }

    const usageRecord = usage as Record<string, unknown>
    const inputTokens =
      this.readTokenCount(usageRecord['inputTokens']) ??
      this.readTokenCount(usageRecord['input_tokens']) ??
      this.readTokenCount(usageRecord['promptTokens']) ??
      this.readTokenCount(usageRecord['prompt_tokens'])
    const outputTokens =
      this.readTokenCount(usageRecord['outputTokens']) ??
      this.readTokenCount(usageRecord['output_tokens']) ??
      this.readTokenCount(usageRecord['completionTokens']) ??
      this.readTokenCount(usageRecord['completion_tokens'])

    if (typeof inputTokens === 'number') {
      state.usedInputTokens = inputTokens
    }
    if (typeof outputTokens === 'number') {
      state.usedOutputTokens = outputTokens
    }
  }

  private readTokenCount(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
    if (value && typeof value === 'object') {
      const total = (value as Record<string, unknown>)['total']
      if (typeof total === 'number' && Number.isFinite(total)) {
        return total
      }
    }

    return undefined
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

  private resolveTemperature(
    options?: Omit<HostedSearchOptions, 'provider'>
  ): number {
    return typeof options?.temperature === 'number' &&
      Number.isFinite(options.temperature)
      ? options.temperature
      : DEFAULT_TEMPERATURE
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
      providerName === 'anthropic'
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
