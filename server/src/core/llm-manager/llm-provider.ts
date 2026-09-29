import path from 'node:path'

import { SERVER_CORE_PATH } from '@/constants'
import { CONFIG_STATE } from '@/core/config-states/config-state'
import { runCompletionAttempt } from '@/core/llm-manager/llm-provider/llm-provider-attempt'
import { LOCAL_SERVER_PROVIDERS } from '@/core/llm-manager/llm-provider/llm-provider-constants'
import { prepareCompletionRequest } from '@/core/llm-manager/llm-provider/llm-provider-request'
import { cleanUpResult } from '@/core/llm-manager/llm-provider/llm-provider-response'
import {
  type CompletionResult,
  type Provider
} from '@/core/llm-manager/llm-provider/llm-provider-types'
import {
  getRoutingModeLLMDisplay,
  type ResolvedLLMTarget
} from '@/core/llm-manager/llm-routing'
import {
  LLMDuties,
  LLMProviders,
  type CompletionParams,
  type PromptOrChatHistory
} from '@/core/llm-manager/types'
import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { FileHelper } from '@/helpers/file-helper'
import { LogHelper } from '@/helpers/log-helper'

const LLM_PROVIDER_NOT_READY_MESSAGE =
  'The LLM provider is not ready yet. Use the built-in command "/model <provider> <model name>" to configure a model. Just press "/" to open built-in commands.'

const NO_LLM_ENABLED_MESSAGE =
  'I need an AI engine before I can answer. Use the built-in command "/model <provider> <model name>" to configure a model. Just press "/" to open built-in commands.'

const LLM_PROVIDERS_MAP = {
  [LLMProviders.LlamaCPP]: 'llamacpp-llm-provider',
  [LLMProviders.SGLang]: 'sglang-llm-provider',
  [LLMProviders.Groq]: 'groq-llm-provider',
  [LLMProviders.OpenRouter]: 'openrouter-llm-provider',
  [LLMProviders.ZAI]: 'z-ai-llm-provider',
  [LLMProviders.DeepSeek]: 'deepseek-llm-provider',
  [LLMProviders.MiniMax]: 'minimax-llm-provider',
  [LLMProviders.OpenAI]: 'openai-llm-provider',
  [LLMProviders.Anthropic]: 'anthropic-llm-provider',
  [LLMProviders.MoonshotAI]: 'moonshotai-llm-provider',
  [LLMProviders.Cerebras]: 'cerebras-llm-provider',
  [LLMProviders.HuggingFace]: 'huggingface-llm-provider',
  [LLMProviders.Celeris]: 'celeris-llm-provider'
}

export default class LLMProvider {
  private workflowLLMProvider: Provider | undefined = undefined
  private agentLLMProvider: Provider | undefined = undefined
  private workflowLLMProviderTargetLabel: string | null = null
  private agentLLMProviderTargetLabel: string | null = null
  private readonly sessionLLMProviders = new Map<string, Provider>()
  private lastProviderErrorMessage: string | null = null
  private llamaCPPServerBootErrorMessage: string | null = null
  private promptSequence = 0

  constructor() {
    LogHelper.title('LLM Provider')
    LogHelper.success(`New instance for profile ${getActiveProfileName()}`)
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
    const modelState = CONFIG_STATE.getModelState()
    const workflowProviderName = modelState.getWorkflowProvider()
    const agentProviderName = modelState.getAgentProvider()

    if (
      workflowProviderName &&
      LOCAL_SERVER_PROVIDERS.has(workflowProviderName) &&
      this.workflowLLMProvider?.modelName
    ) {
      return this.workflowLLMProvider.modelName
    }

    if (
      agentProviderName &&
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

    const configuredProviders = new Set<LLMProviders>(
      [workflowTarget, agentTarget]
        .filter((target) => target.isEnabled && target.provider)
        .map((target) => target.provider as LLMProviders)
    )

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

    if (!providerName) {
      throw new Error('Cannot create an LLM provider for a disabled target.')
    }

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
    const providerName = dutyType === LLMDuties.ReAct
      ? modelState.getAgentProvider()
      : modelState.getWorkflowProvider()

    if (!providerName) {
      throw new Error(LLM_PROVIDER_NOT_READY_MESSAGE)
    }

    return providerName
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

  private shouldShareLocalProviderInstance(
    workflowTarget: ResolvedLLMTarget,
    agentTarget: ResolvedLLMTarget
  ): boolean {
    const workflowIsLocal = workflowTarget.provider
      ? LOCAL_SERVER_PROVIDERS.has(workflowTarget.provider)
      : false
    const agentIsLocal = agentTarget.provider
      ? LOCAL_SERVER_PROVIDERS.has(agentTarget.provider)
      : false

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

  /**
   * Apply the existing completion display cleanup.
   */
  public cleanUpResult(str: string): string {
    return cleanUpResult(str)
  }

  /**
   * Run the completion inference
   */
  public async prompt(
    promptOrChatHistory: PromptOrChatHistory,
    completionParams: CompletionParams
  ): Promise<CompletionResult | null> {
    completionParams.cancellationSignal?.throwIfAborted()
    completionParams.dutyType = completionParams.dutyType ?? null
    const providerName = this.getProviderNameForDuty(completionParams.dutyType)
    const provider = await this.resolveProviderForDuty(completionParams.dutyType)
    completionParams.cancellationSignal?.throwIfAborted()
    const trackProviderErrors = completionParams.trackProviderErrors !== false
    if (trackProviderErrors) {
      this.lastProviderErrorMessage = null
    }

    this.promptSequence += 1
    const measureExecutionTimeLabel =
      `Inference time for "${completionParams.dutyType}" duty #${this.promptSequence}`

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

    prepareCompletionRequest(
      completionParams,
      providerName,
      this.getTargetForDuty(completionParams.dutyType)
    )

    return runCompletionAttempt(
      provider,
      providerName,
      promptOrChatHistory,
      completionParams,
      measureExecutionTimeLabel,
      (params) => this.prompt(promptOrChatHistory, params),
      (message, preserveExisting) => {
        if (!preserveExisting || !this.lastProviderErrorMessage) {
          this.lastProviderErrorMessage = message
        }
      }
    )
  }
}
