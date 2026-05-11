import path from 'node:path'
import { Readable } from 'node:stream'
import { inspect } from 'node:util'

import axios, { type AxiosResponse } from 'axios'

import {
  type CompletionParams,
  type LLMPromptAbortReason,
  type OpenAIToolCall,
  type PromptOrChatHistory,
  LLMDuties,
  LLMProviders
} from '@/core/llm-manager/types'
import { SERVER_CORE_PATH } from '@/constants'
import { LogHelper } from '@/helpers/log-helper'
import { FileHelper } from '@/helpers/file-helper'
import { mergeStreamingChunk } from '@/core/llm-manager/streaming-chunk'
import { CONFIG_STATE } from '@/core/config-states/config-state'
import { BRAIN, LLM_MANAGER } from '@/core'
import {
  type ResolvedLLMTarget,
  getRoutingModeLLMDisplay
} from '@/core/llm-manager/llm-routing'

interface CompletionResult {
  dutyType: LLMDuties
  systemPrompt: string
  input: string
  output: string
  data: Record<string, unknown> | null
  functions?: Record<string, unknown> | undefined
  maxTokens: number
  thoughtTokensBudget?: number
  usedInputTokens: number
  usedOutputTokens: number
  generationDurationMs: number
  providerDecodeDurationMs?: number
  providerTokensPerSecond?: number
  temperature: number
  reasoning?: string
  /**
   * When the model responds with tool calls (native tool calling),
   * this field contains the parsed tool_calls array.
   */
  toolCalls?: OpenAIToolCall[]
}
interface NormalizedCompletionResult {
  rawResult: string
  usedInputTokens: number
  usedOutputTokens: number
  generationDurationMs?: number
  providerDecodeDurationMs?: number
  providerTokensPerSecond?: number
  toolCalls?: OpenAIToolCall[]
  reasoning?: string
}
interface PromptAbortError extends Error {
  promptAbortReason?: LLMPromptAbortReason
}
interface Provider {
  modelName?: string
  runChatCompletion: (
    promptOrChatHistory: PromptOrChatHistory,
    completionParams: CompletionParams
  ) => Promise<unknown>
  boot?: () => Promise<void>
  isServerReady?: () => boolean
  dispose?: () => void
}
const LOCAL_SERVER_PROVIDERS = new Set<LLMProviders>([
  LLMProviders.LlamaCPP,
  LLMProviders.SGLang
])

const LLM_PROVIDERS_MAP = {
  [LLMProviders.LlamaCPP]: 'llamacpp-llm-provider',
  [LLMProviders.SGLang]: 'sglang-llm-provider',
  [LLMProviders.Groq]: 'groq-llm-provider',
  [LLMProviders.OpenRouter]: 'openrouter-llm-provider',
  [LLMProviders.ZAI]: 'z-ai-llm-provider',
  [LLMProviders.OpenAI]: 'openai-llm-provider',
  [LLMProviders.Anthropic]: 'anthropic-llm-provider',
  [LLMProviders.MoonshotAI]: 'moonshotai-llm-provider',
  [LLMProviders.Cerebras]: 'cerebras-llm-provider',
  [LLMProviders.HuggingFace]: 'huggingface-llm-provider'
}
const DEFAULT_MAX_EXECUTION_RETRIES = 2
const DEFAULT_REMOTE_PROVIDER_ERROR_RETRIES = 1
const TIMEOUT_RETRY_INCREMENT_MS = 30_000
const REMOTE_PROVIDER_ERROR_RETRY_DELAY_MS = 5_000
const RETRYABLE_ERROR_RETRY_DELAY_MS = 1_250
const EMPTY_COMPLETION_RETRY_DELAY_MS = 750
const MAX_LOG_SERIALIZED_LENGTH = 4_000
const DEFAULT_TEMPERATURE = 0 // Disabled
const DEFAULT_MAX_TOKENS = 8_192
const NO_LLM_ENABLED_MESSAGE =
  'I need an AI engine before I can answer. Use the built-in command "/model <provider> <model name>" to configure a model. Just press "/" to open built-in commands.'
const LLM_PROVIDER_NOT_READY_MESSAGE =
  'The LLM provider is not ready yet. Use the built-in command "/model <provider> <model name>" to configure a model. Just press "/" to open built-in commands.'
export default class LLMProvider {
  private static instance: LLMProvider

  private workflowLLMProvider: Provider | undefined = undefined
  private agentLLMProvider: Provider | undefined = undefined
  private workflowLLMProviderTargetLabel: string | null = null
  private agentLLMProviderTargetLabel: string | null = null
  private readonly sessionLLMProviders = new Map<string, Provider>()
  private lastProviderErrorMessage: string | null = null
  private llamaCPPServerBootErrorMessage: string | null = null

  constructor() {
    if (!LLMProvider.instance) {
      LogHelper.title('LLM Provider')
      LogHelper.success('New instance')

      LLMProvider.instance = this
    }
  }

  public get isLLMProviderReady(): boolean {
    return !!this.workflowLLMProvider || !!this.agentLLMProvider
  }

  public get agentLLMName(): string {
    const provider = this.getProviderForDuty(LLMDuties.ReAct)
    if (!provider) {
      return 'unknown'
    }

    return provider.modelName || 'unknown'
  }

  public get workflowLLMName(): string {
    const provider = this.getProviderForDuty(null)
    if (!provider) {
      return 'unknown'
    }

    return provider.modelName || 'unknown'
  }

  public get localLLMName(): string {
    const workflowProviderName = this.getProviderNameForDuty(null)
    const agentProviderName = this.getProviderNameForDuty(LLMDuties.ReAct)
    if (
      LOCAL_SERVER_PROVIDERS.has(workflowProviderName) &&
      this.workflowLLMProvider?.modelName
    ) {
      return this.workflowLLMProvider.modelName
    }

    if (
      LOCAL_SERVER_PROVIDERS.has(agentProviderName) &&
      this.agentLLMProvider?.modelName
    ) {
      return this.agentLLMProvider.modelName
    }

    return 'none'
  }

  public get isLlamaCPPServerReady(): boolean {
    const providers = new Set([
      this.workflowLLMProvider,
      this.agentLLMProvider
    ])

    for (const provider of providers) {
      if (provider?.isServerReady?.()) {
        return true
      }
    }

    return false
  }

  public get llamaCPPServerBootStatus(): 'success' | 'loading' | 'error' {
    if (this.isLlamaCPPServerReady) {
      return 'success'
    }

    if (this.llamaCPPServerBootErrorMessage) {
      return 'error'
    }

    return 'loading'
  }

  public get hasLlamaCPPServerBootError(): boolean {
    return !!this.llamaCPPServerBootErrorMessage
  }

  public consumeLastProviderErrorMessage(): string | null {
    const message = this.lastProviderErrorMessage
    this.lastProviderErrorMessage = null
    return message
  }

  /**
   * Initialize the LLM provider
   */
  public async init(): Promise<boolean> {
    LogHelper.title('LLM Provider')
    LogHelper.info('Initializing LLM provider...')
    this.llamaCPPServerBootErrorMessage = null

    const modelState = CONFIG_STATE.getModelState()
    const workflowTarget = modelState.getWorkflowTarget()
    const agentTarget = modelState.getAgentTarget()

    for (const target of [workflowTarget, agentTarget]) {
      if (target.isEnabled && !target.isResolved) {
        LogHelper.error(
          target.resolutionError ||
            `The LLM target "${target.label}" is not resolved.`
        )

        return false
      }
    }

    if (!workflowTarget.isEnabled && !agentTarget.isEnabled) {
      this.disposeCurrentProviders()
      this.workflowLLMProvider = undefined
      this.agentLLMProvider = undefined
      this.workflowLLMProviderTargetLabel = null
      this.agentLLMProviderTargetLabel = null

      LogHelper.title('LLM Provider')
      LogHelper.warning(
        'No LLM is enabled. Leon will start without AI responses until you enable local AI or configure an online provider.'
      )

      return false
    }

    const configuredProviders = new Set<LLMProviders>([
      ...(workflowTarget.isEnabled ? [workflowTarget.provider] : []),
      ...(agentTarget.isEnabled ? [agentTarget.provider] : [])
    ])

    for (const providerName of configuredProviders) {
      if (!Object.values(LLMProviders).includes(providerName)) {
        LogHelper.error(
          `The LLM provider "${providerName}" does not exist or is not yet supported`
        )

        return false
      }
    }

    const shouldShareLocalProvider = this.shouldShareLocalProviderInstance(
      workflowTarget,
      agentTarget
    )

    this.disposeCurrentProviders()
    this.workflowLLMProvider = workflowTarget.isEnabled
      ? await this.createProvider(workflowTarget)
      : undefined
    this.agentLLMProvider = shouldShareLocalProvider
      ? this.workflowLLMProvider
      : agentTarget.isEnabled
        ? await this.createProvider(agentTarget)
        : undefined
    this.workflowLLMProviderTargetLabel = workflowTarget.isEnabled
      ? workflowTarget.label
      : null
    this.agentLLMProviderTargetLabel = agentTarget.isEnabled
      ? agentTarget.label
      : null

    try {
      await this.bootLocalServerProviders()
    } catch (error) {
      if (
        workflowTarget.provider === LLMProviders.LlamaCPP ||
        agentTarget.provider === LLMProviders.LlamaCPP
      ) {
        this.llamaCPPServerBootErrorMessage =
          error instanceof Error ? error.message : String(error)
      }

      throw error
    }

    LogHelper.title('LLM Provider')
    const routingMode = CONFIG_STATE.getRoutingModeState().getRoutingMode()
    const llmDisplay = getRoutingModeLLMDisplay(
      routingMode,
      workflowTarget,
      agentTarget
    )
    LogHelper.success(`Initialized ${llmDisplay.heading.toLowerCase()} ${llmDisplay.value}`)

    return true
  }

  public dispose(): void {
    this.disposeCurrentProviders()
    this.workflowLLMProvider = undefined
    this.agentLLMProvider = undefined
    this.workflowLLMProviderTargetLabel = null
    this.agentLLMProviderTargetLabel = null
  }

  private async createProvider(target: ResolvedLLMTarget): Promise<Provider> {
    const providerName = target.provider
    const providerFileName =
      LLM_PROVIDERS_MAP[providerName as keyof typeof LLM_PROVIDERS_MAP]

    if (!providerFileName) {
      throw new Error(
        `The LLM provider "${providerName}" is not supported.`
      )
    }

    const { default: provider } = await FileHelper.dynamicImportFromFile(
      path.join(
        SERVER_CORE_PATH,
        'llm-manager',
        'llm-providers',
        `${providerFileName}.js`
      )
    )

    return new provider(target) as Provider
  }

  private disposeCurrentProviders(): void {
    const providers = new Set([
      this.workflowLLMProvider as { dispose?: () => void } | undefined,
      this.agentLLMProvider as { dispose?: () => void } | undefined,
      ...this.sessionLLMProviders.values()
    ])

    for (const provider of providers) {
      provider?.dispose?.()
    }

    this.sessionLLMProviders.clear()
  }

  private async bootLocalServerProviders(): Promise<void> {
    const providers = new Set([
      this.workflowLLMProvider,
      this.agentLLMProvider
    ])

    for (const provider of providers) {
      await provider?.boot?.()
    }
  }

  private getProviderNameForDuty(dutyType: LLMDuties | null): LLMProviders {
    const modelState = CONFIG_STATE.getModelState()

    return dutyType === LLMDuties.ReAct
      ? modelState.getAgentProvider()
      : modelState.getWorkflowProvider()
  }

  private getTargetForDuty(dutyType: LLMDuties | null): ResolvedLLMTarget {
    const modelState = CONFIG_STATE.getModelState()

    return dutyType === LLMDuties.ReAct
      ? modelState.getAgentTarget()
      : modelState.getWorkflowTarget()
  }

  private getProviderForDuty(dutyType: LLMDuties | null): Provider | undefined {
    return dutyType === LLMDuties.ReAct
      ? this.agentLLMProvider
      : this.workflowLLMProvider
  }

  private getProviderTargetLabelForDuty(dutyType: LLMDuties | null): string | null {
    return dutyType === LLMDuties.ReAct
      ? this.agentLLMProviderTargetLabel
      : this.workflowLLMProviderTargetLabel
  }

  private getSessionProviderCacheKey(
    dutyType: LLMDuties | null,
    target: ResolvedLLMTarget
  ): string {
    return `${dutyType || 'workflow'}:${target.label}`
  }

  private async resolveProviderForDuty(
    dutyType: LLMDuties | null
  ): Promise<Provider | undefined> {
    const target = this.getTargetForDuty(dutyType)

    if (this.getProviderTargetLabelForDuty(dutyType) === target.label) {
      return this.getProviderForDuty(dutyType)
    }

    if (!target.isEnabled || !target.isResolved) {
      return undefined
    }

    const cacheKey = this.getSessionProviderCacheKey(dutyType, target)
    const cachedProvider = this.sessionLLMProviders.get(cacheKey)

    if (cachedProvider) {
      return cachedProvider
    }

    const provider = await this.createProvider(target)

    await provider.boot?.()
    this.sessionLLMProviders.set(cacheKey, provider)

    return provider
  }

  private getUnavailableProviderMessage(target: ResolvedLLMTarget): string {
    if (!target.isEnabled) {
      return NO_LLM_ENABLED_MESSAGE
    }

    if (!target.isResolved) {
      return (
        target.resolutionError ||
        'The configured LLM target is not resolved yet.'
      )
    }

    return LLM_PROVIDER_NOT_READY_MESSAGE
  }

  private getDefaultTimeoutForProvider(providerName: LLMProviders): number {
    return LOCAL_SERVER_PROVIDERS.has(providerName) ? 32_000 : 120_000
  }

  private shouldShareLocalProviderInstance(
    workflowTarget: ResolvedLLMTarget,
    agentTarget: ResolvedLLMTarget
  ): boolean {
    const workflowIsLocal = LOCAL_SERVER_PROVIDERS.has(workflowTarget.provider)
    const agentIsLocal = LOCAL_SERVER_PROVIDERS.has(agentTarget.provider)

    if (!workflowIsLocal || !agentIsLocal) {
      return false
    }

    if (workflowTarget.provider !== agentTarget.provider) {
      throw new Error(
        `Workflow and agent local providers must match. Received workflow="${workflowTarget.provider}" and agent="${agentTarget.provider}".`
      )
    }

    if (workflowTarget.model !== agentTarget.model) {
      throw new Error(
        `Workflow and agent local models must match for provider "${workflowTarget.provider}". Received workflow="${workflowTarget.model}" and agent="${agentTarget.model}".`
      )
    }

    return true
  }

  private normalizeCompletionResultForLocalProvider(
    rawResult: string,
    completionParams: CompletionParams
  ): NormalizedCompletionResult {
    if (!completionParams.session) {
      return {
        rawResult,
        usedInputTokens: 0,
        usedOutputTokens: 0
      }
    }

    const { usedInputTokens, usedOutputTokens } =
      completionParams.session.sequence.tokenMeter.getState()

    LogHelper.title('LLM Provider')
    LogHelper.debug(
      `Raw context tokens:\n${LLM_MANAGER.model.detokenize(
        completionParams.session.sequence.contextTokens
      )}`
    )

    return {
      rawResult,
      usedInputTokens,
      usedOutputTokens
    }
  }

  private parseProviderResponseData(rawData: unknown): Record<string, unknown> {
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

  private safeSerialize(value: unknown): string {
    if (typeof value === 'string') {
      return value
    }

    if (value === null || value === undefined) {
      return ''
    }

    try {
      return JSON.stringify(value)
    } catch {
      try {
        return inspect(value, {
          depth: 3,
          breakLength: 120,
          maxArrayLength: 30
        })
      } catch {
        return String(value)
      }
    }
  }

  private truncateForLog(input: string): string {
    if (input.length <= MAX_LOG_SERIALIZED_LENGTH) {
      return input
    }

    return `${input.slice(0, MAX_LOG_SERIALIZED_LENGTH)}... [truncated]`
  }

  private isObjectLikeToolSchema(schema: Record<string, unknown>): boolean {
    if (schema['type'] === 'object') {
      return true
    }

    if (
      schema['properties'] &&
      typeof schema['properties'] === 'object' &&
      !Array.isArray(schema['properties'])
    ) {
      return true
    }

    if (Array.isArray(schema['required'])) {
      return true
    }

    const compositeKeywords: Array<'oneOf' | 'anyOf' | 'allOf'> = [
      'oneOf',
      'anyOf',
      'allOf'
    ]

    for (const keyword of compositeKeywords) {
      const variants = schema[keyword]
      if (!Array.isArray(variants) || variants.length === 0) {
        continue
      }

      const allVariantsObjectLike = variants.every((variant) => {
        if (!variant || typeof variant !== 'object' || Array.isArray(variant)) {
          return false
        }

        const variantSchema = variant as Record<string, unknown>
        if (variantSchema['type'] === 'object') {
          return true
        }

        return Boolean(
          variantSchema['properties'] &&
            typeof variantSchema['properties'] === 'object' &&
            !Array.isArray(variantSchema['properties'])
        )
      })

      if (allVariantsObjectLike) {
        return true
      }
    }

    return false
  }

  private normalizeToolSchemasForCompatibility(
    tools: CompletionParams['tools']
  ): CompletionParams['tools'] {
    if (!Array.isArray(tools) || tools.length === 0) {
      return tools
    }

    let hasAdjustedSchema = false

    const normalizedTools = tools.map((tool) => {
      if (!tool?.function?.parameters) {
        return tool
      }

      const parameters = tool.function.parameters
      const hasExplicitType = typeof parameters['type'] === 'string'

      if (hasExplicitType || !this.isObjectLikeToolSchema(parameters)) {
        return tool
      }

      hasAdjustedSchema = true

      return {
        ...tool,
        function: {
          ...tool.function,
          parameters: {
            type: 'object',
            ...parameters
          }
        }
      }
    })

    if (hasAdjustedSchema) {
      LogHelper.title('LLM Provider')
      LogHelper.debug(
        'Normalized tool parameter schema for provider compatibility (added root type="object").'
      )
    }

    return normalizedTools
  }

  private normalizeToolChoiceForCompatibility(
    providerName: LLMProviders,
    toolChoice: CompletionParams['toolChoice'],
    tools: CompletionParams['tools']
  ): CompletionParams['toolChoice'] {
    if (toolChoice === undefined) {
      return toolChoice
    }

    if (!Array.isArray(tools) || tools.length === 0) {
      return toolChoice
    }

    // OpenRouter routes across many upstream providers. Forced/named tool_choice
    // values are not consistently supported across routed endpoints and can fail
    // with 404 "No endpoints found...". Omit tool_choice and keep the tool list
    // constrained for maximum routing compatibility.
    if (providerName === LLMProviders.OpenRouter) {
      if (toolChoice === 'required') {
        LogHelper.title('LLM Provider')
        LogHelper.debug(
          'OpenRouter compatibility: omitted tool_choice="required" (tool list remains constrained).'
        )
        return undefined
      }

      if (typeof toolChoice !== 'string') {
        LogHelper.title('LLM Provider')
        LogHelper.debug(
          'OpenRouter compatibility: omitted named tool_choice (tool list remains constrained).'
        )
        return undefined
      }
    }

    // Z.AI currently supports tool_choice="auto". Omit unsupported values
    // (named/required/none) to preserve compatibility.
    if (providerName === LLMProviders.ZAI) {
      if (typeof toolChoice !== 'string') {
        LogHelper.title('LLM Provider')
        LogHelper.debug(
          'Z.AI compatibility: omitted named tool_choice; using provider default.'
        )
        return undefined
      }

      if (toolChoice !== 'auto') {
        LogHelper.title('LLM Provider')
        LogHelper.debug(
          `Z.AI compatibility: omitted unsupported tool_choice="${toolChoice}".`
        )
        return undefined
      }
    }

    if (providerName === LLMProviders.LlamaCPP) {
      if (typeof toolChoice !== 'string') {
        LogHelper.title('LLM Provider')
        LogHelper.debug(
          'llama.cpp compatibility: converted named tool_choice to "required".'
        )
        return 'required'
      }
    }

    return toolChoice
  }

  private withOmittedToolChoice(
    completionParams: CompletionParams
  ): CompletionParams {
    const nextParams: CompletionParams = {
      ...completionParams
    }

    if ('toolChoice' in nextParams) {
      delete nextParams.toolChoice
    }

    return nextParams
  }

  private shouldDisableThinkingForForcedToolChoice(
    providerName: LLMProviders,
    completionParams: CompletionParams
  ): boolean {
    if (providerName !== LLMProviders.LlamaCPP) {
      return false
    }

    return (
      Array.isArray(completionParams.tools) &&
      completionParams.tools.length > 0 &&
      completionParams.toolChoice !== undefined &&
      completionParams.toolChoice !== 'auto'
    )
  }

  private isRetryablePromptError(error: unknown): boolean {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status
      if (typeof status === 'number') {
        return status >= 500 || status === 408 || status === 429
      }

      const code = (error.code || '').toUpperCase()
      if (
        code === 'ECONNABORTED' ||
        code === 'ECONNRESET' ||
        code === 'ETIMEDOUT' ||
        code === 'EAI_AGAIN' ||
        code === 'ENOTFOUND' ||
        code === 'ERR_NETWORK'
      ) {
        return true
      }

      return !error.response
    }

    const errorObject =
      error && typeof error === 'object'
        ? (error as { message?: unknown, name?: unknown, status?: unknown })
        : null
    const status =
      errorObject && typeof errorObject.status === 'number'
        ? errorObject.status
        : null
    if (status !== null) {
      return status >= 500 || status === 408 || status === 429
    }

    const name = String(errorObject?.name ?? '').toLowerCase()
    const message = String(errorObject?.message ?? error ?? '').toLowerCase()
    const combined = `${name} ${message}`

    return (
      combined.includes('connectionerror') ||
      combined.includes('fetch failed') ||
      combined.includes('network error') ||
      combined.includes('socket hang up') ||
      combined.includes('econnreset') ||
      combined.includes('etimedout') ||
      combined.includes('timed out') ||
      combined.includes('timeout') ||
      combined.includes('request timeout') ||
      combined.includes('deadline exceeded') ||
      combined.includes('eai_again') ||
      combined.includes('enotfound') ||
      combined.includes('provider overloaded')
    )
  }

  private isTimeoutLikeError(error: unknown): boolean {
    const promptAbortReason = this.getPromptAbortReason(error)
    if (promptAbortReason?.retryStrategy === 'timeout') {
      return true
    }

    if (axios.isAxiosError(error)) {
      const status = error.response?.status
      if (status === 408 || status === 504) {
        return true
      }

      const code = (error.code || '').toUpperCase()
      if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
        return true
      }
    }

    const errorObject =
      error && typeof error === 'object'
        ? (error as { message?: unknown, name?: unknown, cause?: unknown })
        : null

    const combined = `${String(errorObject?.name ?? '')} ${String(
      errorObject?.message ?? error ?? ''
    )} ${String(errorObject?.cause ?? '')}`.toLowerCase()

    return (
      combined.includes('timeout (') ||
      combined.includes('timed out') ||
      combined.includes('timeout') ||
      combined.includes('request timeout') ||
      combined.includes('deadline exceeded')
    )
  }

  private waitForRetry(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, delayMs)
    })
  }

  private isThinkingToolChoiceConflictError(error: unknown): boolean {
    const message = String(error ?? '').toLowerCase()
    return (
      message.includes('tool_choice') &&
      message.includes('thinking') &&
      (message.includes('incompatible') || message.includes('not supported'))
    )
  }

  private isUnsupportedToolChoiceError(error: unknown): boolean {
    const message = String(error ?? '').toLowerCase()

    if (!message.includes('tool_choice')) {
      return false
    }

    return (
      message.includes('no endpoints found') ||
      message.includes('support the provided') ||
      message.includes('unsupported value') ||
      message.includes('invalid value') ||
      message.includes('not supported')
    )
  }

  private buildProviderErrorDetails(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status
      const data = error.response?.data
      return this.truncateForLog(
        this.safeSerialize({
          name: error.name,
          message: error.message,
          ...(typeof status === 'number' ? { status } : {}),
          ...(data !== undefined ? { data } : {})
        })
      )
    }

    const errorObject =
      error && typeof error === 'object'
        ? (error as Record<string, unknown>)
        : null

    if (!errorObject) {
      return this.truncateForLog(String(error))
    }

    const details: Record<string, unknown> = {
      name:
        typeof errorObject['name'] === 'string'
          ? (errorObject['name'] as string)
          : 'Error',
      message:
        typeof errorObject['message'] === 'string'
          ? (errorObject['message'] as string)
          : String(error)
    }

    if (typeof errorObject['status'] === 'number') {
      details['status'] = errorObject['status'] as number
    }
    if (typeof errorObject['statusCode'] === 'number') {
      details['statusCode'] = errorObject['statusCode'] as number
    }
    if (errorObject['body'] !== undefined) {
      details['body'] = errorObject['body']
    }
    if (errorObject['error'] !== undefined) {
      details['error'] = errorObject['error']
    }
    if (errorObject['cause'] !== undefined) {
      details['cause'] = errorObject['cause']
    }

    return this.truncateForLog(this.safeSerialize(details))
  }

  private formatPromptErrorForLog(error: unknown): string {
    const errorObject =
      error && typeof error === 'object'
        ? (error as { message?: unknown, name?: unknown })
        : null
    const message =
      typeof errorObject?.message === 'string'
        ? errorObject.message
        : String(error)
    const name =
      typeof errorObject?.name === 'string' ? errorObject.name : 'Error'

    if (message && message !== '[object Object]') {
      return `${name}: ${message}`
    }

    const details = this.buildProviderErrorDetails(error)
    return details || String(error)
  }

  private isPromptAbortReason(value: unknown): value is LLMPromptAbortReason {
    if (!value || typeof value !== 'object') {
      return false
    }

    const reason = value as Record<string, unknown>
    return (
      reason['shouldRetry'] === true &&
      reason['retryStrategy'] === 'timeout' &&
      reason['source'] === 'react_tool_call_diagnosis' &&
      typeof reason['delayMs'] === 'number'
    )
  }

  private getPromptAbortReason(error: unknown): LLMPromptAbortReason | null {
    if (!error || typeof error !== 'object') {
      return null
    }

    const promptAbortReason = (error as PromptAbortError).promptAbortReason
    return this.isPromptAbortReason(promptAbortReason)
      ? promptAbortReason
      : null
  }

  private createPromptAbortError(reason: LLMPromptAbortReason): PromptAbortError {
    const error = new Error(
      `Prompt aborted by caller after ${reason.delayMs}ms grace period`
    ) as PromptAbortError
    error.name = 'LLMPromptAbortError'
    error.promptAbortReason = reason

    return error
  }

  private omitCompletionSignal(
    completionParams: CompletionParams
  ): Omit<CompletionParams, 'signal'> {
    const { signal, ...retryParams } = completionParams
    void signal

    return retryParams
  }

  private buildProviderErrorMessage(
    providerName: LLMProviders,
    error: string,
    details = '',
    isRemoteProvider = false
  ): string {
    return BRAIN.wernicke(
      isRemoteProvider
        ? 'llm_remote_provider_error'
        : 'llm_provider_http_error',
      '',
      {
        '{{ provider }}': providerName,
        '{{ error }}': error,
        '{{ api_error }}': details ? `\n${details}` : ''
      }
    )
  }

  private extractOpenAICompatibleReasoningFragments(
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

  private extractOpenAICompatibleReasoning(
    message: Record<string, unknown>
  ): string {
    const uniqueChunks: string[] = []
    for (const chunk of this.extractOpenAICompatibleReasoningFragments(message)) {
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

  private normalizeCompletionResultForOpenAICompatibleProvider(
    rawResult: AxiosResponse
  ): NormalizedCompletionResult {
    const parsedCompletionResult = this.parseProviderResponseData(rawResult.data)
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

    const reasoning = this.extractOpenAICompatibleReasoning(message)
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

  private toOpenAIResponsesToolCall(
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

  private extractOpenAIResponsesText(
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

  private extractOpenAIResponsesToolCalls(
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

      const toolCall = this.toOpenAIResponsesToolCall(item, index)
      if (toolCall) {
        toolCalls.push(toolCall)
      }
    }

    return toolCalls
  }

  private extractOpenAIResponsesReasoningFromItem(
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

  private extractOpenAIResponsesReasoningFragments(
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
      chunks.push(...this.extractOpenAIResponsesReasoningFromItem(item))
    }

    const output = Array.isArray(parsedChunk['output'])
      ? (parsedChunk['output'] as unknown[])
      : []
    for (const outputItem of output) {
      if (!outputItem || typeof outputItem !== 'object') {
        continue
      }

      chunks.push(
        ...this.extractOpenAIResponsesReasoningFromItem(
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
          ...this.extractOpenAIResponsesReasoningFromItem(
            outputItem as Record<string, unknown>
          )
        )
      }
    }

    return chunks
  }

  private normalizeCompletionResultForOpenAIResponsesProvider(
    rawResult: AxiosResponse
  ): NormalizedCompletionResult {
    const parsedCompletionResult = this.parseProviderResponseData(rawResult.data)
    const usage =
      parsedCompletionResult['usage'] &&
      typeof parsedCompletionResult['usage'] === 'object'
        ? (parsedCompletionResult['usage'] as Record<string, unknown>)
        : {}

    const toolCalls = this.extractOpenAIResponsesToolCalls(parsedCompletionResult)
    const result: NormalizedCompletionResult = {
      rawResult: this.extractOpenAIResponsesText(parsedCompletionResult),
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

    if (toolCalls.length > 0) {
      result.toolCalls = toolCalls
    }

    const reasoningChunks = this.extractOpenAIResponsesReasoningFragments(
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

  private isReadableStream(value: unknown): value is Readable {
    return (
      value instanceof Readable ||
      (!!value &&
        typeof value === 'object' &&
        typeof (value as { [Symbol.asyncIterator]?: unknown })[
          Symbol.asyncIterator
        ] === 'function')
    )
  }

  private async normalizeStreamingCompletionResult(
    rawResult: AxiosResponse,
    completionParams: CompletionParams,
    providerName: LLMProviders
  ): Promise<NormalizedCompletionResult> {
    const responseStream = rawResult.data
    if (!this.isReadableStream(responseStream)) {
      return {
        rawResult: '',
        usedInputTokens: 0,
        usedOutputTokens: 0
      }
    }

    let textOutput = ''
    let reasoningOutput = ''
    let usedInputTokens = 0
    let usedOutputTokens = 0
    let providerDecodeDurationMs = 0
    let providerTokensPerSecond = 0
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

      for (const reasoningChunk of this.extractOpenAICompatibleReasoningFragments(
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

      for (const reasoningChunk of this.extractOpenAIResponsesReasoningFragments(
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
          const messageText = this.extractOpenAIResponsesText({
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
          textOutput = this.extractOpenAIResponsesText(response)
        }

        if (toolCallOrder.length === 0) {
          for (const [index, toolCall] of this
            .extractOpenAIResponsesToolCalls(response)
            .entries()) {
            const mapKey = `completed_${index}`
            toolCallsById[mapKey] = toolCall
            toolCallOrder.push(mapKey)
          }
        }
      }
    }

    for await (const chunk of responseStream as AsyncIterable<unknown>) {
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
      usedInputTokens,
      usedOutputTokens,
      ...(providerDecodeDurationMs > 0 ? { providerDecodeDurationMs } : {}),
      ...(providerTokensPerSecond > 0 ? { providerTokensPerSecond } : {}),
      ...(reasoningOutput.trim().length > 0
        ? { reasoning: reasoningOutput.trim() }
        : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {})
    }
  }

  public cleanUpResult(str: string): string {
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
   * Run the completion inference
   */
  public async prompt(
    promptOrChatHistory: PromptOrChatHistory,
    completionParams: CompletionParams
  ): Promise<CompletionResult | null> {
    completionParams.dutyType = completionParams.dutyType ?? null
    const providerName = this.getProviderNameForDuty(completionParams.dutyType)
    const provider = await this.resolveProviderForDuty(completionParams.dutyType)
    const trackProviderErrors = completionParams.trackProviderErrors !== false
    if (trackProviderErrors) {
      this.lastProviderErrorMessage = null
    }

    const measureExecutionTimeLabel = `Inference time for "${completionParams.dutyType}" duty`

    LogHelper.title('LLM Provider')
    LogHelper.info(`Using "${providerName}" provider for completion...`)
    LogHelper.time(measureExecutionTimeLabel)

    if (!provider) {
      const target = this.getTargetForDuty(completionParams.dutyType)
      const unavailableProviderMessage =
        this.getUnavailableProviderMessage(target)

      LogHelper.error(unavailableProviderMessage)

      if (trackProviderErrors) {
        this.lastProviderErrorMessage = unavailableProviderMessage
      }

      return null
    }

    completionParams.timeout =
      completionParams.timeout ?? this.getDefaultTimeoutForProvider(providerName)
    completionParams.maxRetries =
      completionParams.maxRetries ?? DEFAULT_MAX_EXECUTION_RETRIES
    completionParams.data = completionParams.data ?? null
    completionParams.functions = completionParams.functions ?? undefined
    completionParams.systemPrompt = completionParams.systemPrompt ?? ''
    completionParams.temperature =
      completionParams.temperature ?? DEFAULT_TEMPERATURE
    completionParams.maxTokens =
      completionParams.maxTokens ?? DEFAULT_MAX_TOKENS
    completionParams.remoteProviderErrorRetries =
      completionParams.remoteProviderErrorRetries ??
      DEFAULT_REMOTE_PROVIDER_ERROR_RETRIES

    /**
     * TODO: support onToken (stream) for Groq provider too
     */
    completionParams.onToken = completionParams.onToken || ((): void => {})
    completionParams.onReasoningToken =
      completionParams.onReasoningToken || ((): void => {})
    completionParams.shouldStream = completionParams.shouldStream ?? false

    const normalizedTools = this.normalizeToolSchemasForCompatibility(
      completionParams.tools
    )
    if (normalizedTools) {
      completionParams.tools = normalizedTools
    } else if ('tools' in completionParams) {
      delete completionParams.tools
    }

    const normalizedToolChoice = this.normalizeToolChoiceForCompatibility(
      providerName,
      completionParams.toolChoice,
      completionParams.tools
    )
    if (normalizedToolChoice !== undefined) {
      completionParams.toolChoice = normalizedToolChoice
    } else if ('toolChoice' in completionParams) {
      delete completionParams.toolChoice
    }

    if (
      this.shouldDisableThinkingForForcedToolChoice(
        providerName,
        completionParams
      ) &&
      completionParams.disableThinking !== true
    ) {
      completionParams.disableThinking = true
      LogHelper.title('LLM Provider')
      LogHelper.debug(
        'llama.cpp compatibility: disabled thinking because tool_choice is forced.'
      )
    }

    const isJSONMode = completionParams.data !== null
    const shouldStreamOutput = completionParams.shouldStream === true
    const isRemoteProvider = !LOCAL_SERVER_PROVIDERS.has(providerName)

    const abortController = new AbortController()
    let timeoutHandle: NodeJS.Timeout | null = null
    let streamStallTimeoutHandle: NodeJS.Timeout | null = null
    let hasStartedStreaming = false
    const completionStartedAt = Date.now()
    let generationStartedAt: number | null = null
    const callerAbortSignal = completionParams.signal
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
    const resetStreamStallTimeout = (): void => {
      if (!shouldStreamOutput || !completionParams.timeout) {
        return
      }

      clearStreamStallTimeout()
      streamStallTimeoutHandle = setTimeout(() => {
        if (!abortController.signal.aborted) {
          abortController.abort()
        }

        rejectStreamStall?.(
          new Error(
            `Timeout (${completionParams.timeout}ms) for "${completionParams.dutyType}" duty after streaming stalled`
          )
        )
      }, completionParams.timeout)
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
            'Streaming started; inference timeout watchdog replaced by stream stall watchdog for this completion'
          )
        }
      }
    }

    const onTokenWithStreamStart = (chunk: OnTokenChunk): void => {
      if (typeof chunk === 'string' && chunk.length === 0) {
        markStreamStarted()
        resetStreamStallTimeout()
        userOnToken?.(chunk)
        return
      }

      markStreamStarted()
      resetStreamStallTimeout()
      userOnToken?.(chunk)
    }

    const onReasoningTokenWithStreamStart = (reasoningChunk: string): void => {
      if (reasoningChunk.length === 0) {
        markStreamStarted()
        resetStreamStallTimeout()
        userOnReasoningToken?.(reasoningChunk)
        return
      }

      markStreamStarted()
      resetStreamStallTimeout()
      userOnReasoningToken?.(reasoningChunk)
    }

    const completionParamsWithAbort = {
      ...completionParams,
      shouldStream: shouldStreamOutput,
      onToken: onTokenWithStreamStart,
      onReasoningToken: onReasoningTokenWithStreamStart,
      signal: abortController.signal
    }

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

        if (this.isPromptAbortReason(callerAbortSignal.reason)) {
          reject(this.createPromptAbortError(callerAbortSignal.reason))
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
      removeCallerAbortListener()
      LogHelper.title('LLM Provider')
      LogHelper.error(
        `Error to complete prompt: ${this.formatPromptErrorForLog(e)}`
      )
      LogHelper.timeEnd(measureExecutionTimeLabel)

      if (trackProviderErrors) {
        this.lastProviderErrorMessage = this.buildProviderErrorMessage(
          providerName,
          this.formatPromptErrorForLog(e),
          this.buildProviderErrorDetails(e),
          isRemoteProvider
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
      removeCallerAbortListener()
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
      clearStreamStallTimeout()
      rejectStreamStall = null

      LogHelper.title('LLM Provider')
      LogHelper.error(
        `Error to complete prompt: ${this.formatPromptErrorForLog(e)}`
      )
      LogHelper.timeEnd(measureExecutionTimeLabel)

      const isTimeoutError = this.isTimeoutLikeError(e)
      const isRetryableNonTimeoutError = this.isRetryablePromptError(e)
      const isThinkingToolChoiceConflict =
        this.isThinkingToolChoiceConflictError(e)
      const isUnsupportedToolChoice = this.isUnsupportedToolChoiceError(e)
      const promptAbortReason = this.getPromptAbortReason(e)
      const remainingRetries = completionParams.maxRetries ?? 0
      const remainingRemoteProviderErrorRetries =
        completionParams.remoteProviderErrorRetries ?? 0

      const hasForcedToolChoice =
        Array.isArray(completionParams.tools) &&
        completionParams.tools.length > 0 &&
        completionParams.toolChoice !== undefined &&
        completionParams.toolChoice !== 'auto'

      if (
        isThinkingToolChoiceConflict &&
        hasForcedToolChoice &&
        !completionParams.relaxForcedToolChoice &&
        remainingRetries > 0
      ) {
        if (completionParams.disableThinking !== true) {
          LogHelper.title('LLM Provider')
          LogHelper.warning(
            'Provider rejected forced tool_choice with thinking enabled; retrying with thinking disabled while keeping tool_choice'
          )

          return this.prompt(promptOrChatHistory, {
            ...completionParams,
            disableThinking: true,
            maxRetries: remainingRetries - 1
          })
        }

        LogHelper.title('LLM Provider')
        LogHelper.warning(
          'Provider rejected forced tool_choice with thinking enabled; retrying without tool_choice'
        )

        const retryParams = this.withOmittedToolChoice(completionParams)
        return this.prompt(promptOrChatHistory, {
          ...retryParams,
          relaxForcedToolChoice: true,
          maxRetries: remainingRetries - 1
        })
      }

      if (
        isUnsupportedToolChoice &&
        hasForcedToolChoice &&
        !completionParams.relaxForcedToolChoice &&
        remainingRetries > 0
      ) {
        LogHelper.title('LLM Provider')
        LogHelper.warning(
          'Provider rejected forced tool_choice; retrying without tool_choice for compatibility'
        )

        const retryParams = this.withOmittedToolChoice(completionParams)
        return this.prompt(promptOrChatHistory, {
          ...retryParams,
          relaxForcedToolChoice: true,
          maxRetries: remainingRetries - 1
        })
      }

      if (
        !isTimeoutError &&
        isRemoteProvider &&
        remainingRemoteProviderErrorRetries > 0
      ) {
        if (!abortController.signal.aborted) {
          abortController.abort()
        }

        await this.waitForRetry(REMOTE_PROVIDER_ERROR_RETRY_DELAY_MS)

        LogHelper.title('LLM Provider')
        LogHelper.warning(
          `Remote provider failed; retrying after ${REMOTE_PROVIDER_ERROR_RETRY_DELAY_MS}ms (${remainingRemoteProviderErrorRetries} retry left)`
        )

        return this.prompt(promptOrChatHistory, {
          ...completionParams,
          remoteProviderErrorRetries: remainingRemoteProviderErrorRetries - 1
        })
      }

      if (
        (isTimeoutError || (!isRemoteProvider && isRetryableNonTimeoutError)) &&
        remainingRetries > 0
      ) {
        if (!abortController.signal.aborted) {
          abortController.abort()
        }

        const nextTimeout = isTimeoutError
          ? (completionParams.timeout ?? 0) + TIMEOUT_RETRY_INCREMENT_MS
          : completionParams.timeout
        const retryParams = promptAbortReason?.shouldRetry
          ? this.omitCompletionSignal(completionParams)
          : completionParams

        if (!isTimeoutError) {
          await this.waitForRetry(RETRYABLE_ERROR_RETRY_DELAY_MS)
        }

        LogHelper.title('LLM Provider')
        LogHelper.warning(
          isTimeoutError
            ? `Prompt timed out. Previous inference canceled; retrying with timeout=${nextTimeout}ms (${remainingRetries} retry left)`
            : `Prompt failed with a retryable provider/network error; retrying (${remainingRetries} retry left)`
        )

        return this.prompt(promptOrChatHistory, {
          ...retryParams,
          timeout: nextTimeout,
          maxRetries: remainingRetries - 1
        })
      }

      if (trackProviderErrors && !this.lastProviderErrorMessage) {
        const apiErrorDetails = this.buildProviderErrorDetails(e)
        const statusLike =
          e && typeof e === 'object' && 'statusCode' in e
            ? (e as { statusCode?: unknown }).statusCode
            : undefined

        this.lastProviderErrorMessage = this.buildProviderErrorMessage(
          providerName,
          statusLike !== undefined
            ? `${this.formatPromptErrorForLog(e)} (statusCode=${String(
                statusLike
              )})`
            : this.formatPromptErrorForLog(e),
          apiErrorDetails,
          isRemoteProvider
        )
      }

      return null

      /*// Avoid infinite loop
      if (!completionParams.maxRetries || completionParams.maxRetries <= 0) {
        throw new Error('Prompt failed after all retries')
      }

      if (completionParams.maxRetries > 0) {
        LogHelper.info('Prompt took too long or failed. Retrying...')

        return this.prompt(prompt, {
          ...completionParams,
          maxRetries: completionParams.maxRetries - 1
        })
      } else {
        LogHelper.error(
          `Prompt failed after ${completionParams.maxRetries} retries`
        )

        return null
      }*/
    }

    removeCallerAbortListener()

    let usedInputTokens = 0
    let usedOutputTokens = 0
    let generationDurationMs = 0
    let providerDecodeDurationMs: number | undefined
    let providerTokensPerSecond: number | undefined
    let toolCalls: OpenAIToolCall[] | undefined
    let reasoning: string | undefined

    /**
     * Normalize the completion result according to the provider
     */
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
        isRemoteProvider && this.isReadableStream(remoteStreamCandidate)
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
          this.normalizeStreamingCompletionResult(
            streamResponse,
            completionParams,
            providerName
          ),
          streamStallTimeoutPromise,
          callerAbortPromise
        ])) as NormalizedCompletionResult

        rawResult = normalized.rawResult
        usedInputTokens = normalized.usedInputTokens
        usedOutputTokens = normalized.usedOutputTokens
        providerDecodeDurationMs = normalized.providerDecodeDurationMs
        providerTokensPerSecond = normalized.providerTokensPerSecond
        generationDurationMs =
          normalized.generationDurationMs ??
          Math.max(Date.now() - (generationStartedAt ?? completionStartedAt), 0)
        toolCalls = normalized.toolCalls
        reasoning = normalized.reasoning
      } else if (providerName === LLMProviders.Local) {
        if (completionParams.session) {
          const {
            rawResult: result,
            usedInputTokens: inputTokens,
            usedOutputTokens: outputTokens
          } = this.normalizeCompletionResultForLocalProvider(
            rawResult as string,
            completionParams
          )

          rawResult = result
          usedInputTokens = inputTokens
          usedOutputTokens = outputTokens
          generationDurationMs = Math.max(
            Date.now() - (generationStartedAt ?? completionStartedAt),
            0
          )
        }
      } else if (
        [
          LLMProviders.Groq,
          LLMProviders.LlamaCPP,
          LLMProviders.SGLang,
          LLMProviders.ZAI,
          LLMProviders.Anthropic,
          LLMProviders.MoonshotAI,
          LLMProviders.Cerebras,
          LLMProviders.HuggingFace
        ].includes(providerName)
      ) {
        const normalized = this.normalizeCompletionResultForOpenAICompatibleProvider(
          rawResult as AxiosResponse
        )

        rawResult = normalized.rawResult
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
      } else if (
        [LLMProviders.OpenAI, LLMProviders.OpenRouter].includes(
          providerName
        )
      ) {
        const parsedResponseData = this.parseProviderResponseData(
          (rawResult as AxiosResponse).data
        )
        const normalized = Array.isArray(parsedResponseData['choices'])
          ? this.normalizeCompletionResultForOpenAICompatibleProvider(
              rawResult as AxiosResponse
            )
          : this.normalizeCompletionResultForOpenAIResponsesProvider(
              rawResult as AxiosResponse
            )

        rawResult = normalized.rawResult
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
      } else {
        LogHelper.error(`The LLM provider "${providerName}" is not yet supported`)
        return null
      }

      rawResultString = rawResult as string

      if (typeof rawResult === 'string') {
        rawResultString = this.cleanUpResult(rawResultString)
      }

      if (reasoning && reasoning.trim()) {
        LogHelper.title('LLM Provider')
        LogHelper.debug(`Reasoning:\n${this.truncateForLog(reasoning)}`)

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
          ? this.truncateForLog(this.safeSerialize(remoteRawData))
          : ''

      LogHelper.title('LLM Provider')
      LogHelper.warning(
        `Received empty completion payload (no text/tool_calls/tokens) from "${providerName}".${providerPayloadSnippet ? ` Payload: ${providerPayloadSnippet}` : ''}`
      )

      if (remainingRetries > 0) {
        await this.waitForRetry(EMPTY_COMPLETION_RETRY_DELAY_MS)
        return this.prompt(promptOrChatHistory, {
          ...completionParams,
          maxRetries: remainingRetries - 1
        })
      }

      if (trackProviderErrors) {
        this.lastProviderErrorMessage = this.buildProviderErrorMessage(
          providerName,
          'Provider returned an empty completion payload (no text, no tool call, no token usage)',
          providerPayloadSnippet,
          isRemoteProvider
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
          : this.safeSerialize(promptOrChatHistory),
      // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
      output: (() => {
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
      })(),
      data: completionParams.data,
      functions: completionParams.functions,
      maxTokens: completionParams.maxTokens,
      ...(typeof completionParams.thoughtTokensBudget === 'number'
        ? { thoughtTokensBudget: completionParams.thoughtTokensBudget }
        : {}),
      // Current used context size
      usedInputTokens,
      usedOutputTokens,
      generationDurationMs,
      ...(providerDecodeDurationMs ? { providerDecodeDurationMs } : {}),
      ...(providerTokensPerSecond ? { providerTokensPerSecond } : {}),
      ...(reasoning ? { reasoning } : {}),
      ...(toolCalls ? { toolCalls } : {})
    }
  }
}
