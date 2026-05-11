import path from 'node:path'

import {
  DEFAULT_INSTALLED_LLM_PATH,
  LEON_LLM,
  LLM_DIR_PATH
} from '@/constants'
import {
  type ResolvedLLMTarget,
  resolveConfiguredLLMTarget
} from '@/core/llm-manager/llm-routing'
import { getLLMProviderAccountConfig } from '@/core/llm-manager/llm-provider-account-configs'
import { LLMProviders } from '@/core/llm-manager/types'
import {
  CONFIG_STATE_EVENT_EMITTER,
  MODEL_CONFIGURATION_UPDATED_EVENT
} from '@/core/config-states/config-state-event-emitter'
import { ProfileHelper } from '@/helpers/profile-helper'
import { FileHelper } from '@/helpers/file-helper'
import { getActiveConversationSessionModelTarget } from '@/core/session-manager/session-context'

const GLOBAL_LLM_ENV_KEY = 'LEON_LLM'

const LOCAL_MODEL_PROVIDERS = new Set<LLMProviders>([
  LLMProviders.LlamaCPP,
  LLMProviders.SGLang
])

function getInitialWorkflowTargetValue(): string {
  return LEON_LLM.trim()
}

function getInitialAgentTargetValue(): string {
  return LEON_LLM.trim()
}

function resolveTarget(rawTarget: string): ResolvedLLMTarget {
  return resolveConfiguredLLMTarget(rawTarget, {
    defaultInstalledLLMPath: DEFAULT_INSTALLED_LLM_PATH,
    llmDirPath: LLM_DIR_PATH
  })
}

function getTargetModelName(target: ResolvedLLMTarget): string {
  if (!target.isEnabled) {
    return 'disabled'
  }

  if (!target.isResolved || !target.model) {
    return 'unknown'
  }

  return LOCAL_MODEL_PROVIDERS.has(target.provider)
    ? path.basename(target.model) || target.model
    : target.model
}

function getSupportedModelProviders(): LLMProviders[] {
  return Object.values(LLMProviders).filter(
    (provider) =>
      provider !== LLMProviders.None && provider !== LLMProviders.Local
  )
}

function resolveLocalModelCandidatePath(model: string): string {
  return path.isAbsolute(model) ? model : path.join(LLM_DIR_PATH, model)
}

export class ModelState {
  private workflowTargetValue = getInitialWorkflowTargetValue()
  private agentTargetValue = getInitialAgentTargetValue()
  private workflowTarget = resolveTarget(this.workflowTargetValue)
  private agentTarget = resolveTarget(this.agentTargetValue)

  private getActiveSessionTargetValue(): string | null {
    const target = getActiveConversationSessionModelTarget()

    return target && target.trim() ? target.trim() : null
  }

  public getSupportedProviders(): LLMProviders[] {
    return getSupportedModelProviders()
  }

  public getWorkflowTargetValue(): string {
    return this.getActiveSessionTargetValue() || this.workflowTargetValue
  }

  public getAgentTargetValue(): string {
    return this.getActiveSessionTargetValue() || this.agentTargetValue
  }

  public getWorkflowTarget(): ResolvedLLMTarget {
    const activeSessionTargetValue = this.getActiveSessionTargetValue()

    return activeSessionTargetValue
      ? resolveTarget(activeSessionTargetValue)
      : this.workflowTarget
  }

  public getAgentTarget(): ResolvedLLMTarget {
    const activeSessionTargetValue = this.getActiveSessionTargetValue()

    return activeSessionTargetValue
      ? resolveTarget(activeSessionTargetValue)
      : this.agentTarget
  }

  public hasEnabledTarget(): boolean {
    return this.workflowTarget.isEnabled || this.agentTarget.isEnabled
  }

  public getWorkflowProvider(): LLMProviders {
    return this.workflowTarget.provider
  }

  public getAgentProvider(): LLMProviders {
    return this.agentTarget.provider
  }

  public getWorkflowModelName(): string {
    return getTargetModelName(this.workflowTarget)
  }

  public getAgentModelName(): string {
    return getTargetModelName(this.agentTarget)
  }

  public getLocalModelName(): string {
    if (LOCAL_MODEL_PROVIDERS.has(this.workflowTarget.provider)) {
      return this.getWorkflowModelName()
    }

    if (LOCAL_MODEL_PROVIDERS.has(this.agentTarget.provider)) {
      return this.getAgentModelName()
    }

    return 'none'
  }

  public getConfiguredTargetDisplay(): string {
    if (this.workflowTarget.label === this.agentTarget.label) {
      return this.workflowTarget.label
    }

    return `workflow=${this.workflowTarget.label}, agent=${this.agentTarget.label}`
  }

  public isSupportedProvider(provider: string): provider is LLMProviders {
    return this.getSupportedProviders().includes(provider as LLMProviders)
  }

  public isLocalProvider(provider: LLMProviders): boolean {
    return LOCAL_MODEL_PROVIDERS.has(provider)
  }

  public getProviderAPIKeyEnv(provider: LLMProviders): string | null {
    return getLLMProviderAccountConfig(provider)?.apiKeyEnv || null
  }

  public getProviderAPIKeyURL(provider: LLMProviders): string | null {
    return getLLMProviderAccountConfig(provider)?.apiKeyURL || null
  }

  public getProviderLabel(provider: LLMProviders): string {
    return getLLMProviderAccountConfig(provider)?.label || provider
  }

  public providerRequiresAPIKey(provider: LLMProviders): boolean {
    return !!this.getProviderAPIKeyEnv(provider) && !this.isLocalProvider(provider)
  }

  public hasProviderAPIKey(provider: LLMProviders): boolean {
    const apiKeyEnv = this.getProviderAPIKeyEnv(provider)

    if (!apiKeyEnv) {
      return true
    }

    return String(process.env[apiKeyEnv] || '').trim() !== ''
  }

  public createConfiguredTargetValue(
    provider: LLMProviders,
    model: string
  ): string {
    const normalizedModel = model.trim()
    const localModelCandidatePath = resolveLocalModelCandidatePath(normalizedModel)

    if (!normalizedModel) {
      throw new Error(`The provider "${provider}" requires a model value.`)
    }

    if (path.isAbsolute(normalizedModel) && !this.isLocalProvider(provider)) {
      throw new Error(
        `Absolute model paths are only supported for local providers such as "${LLMProviders.LlamaCPP}".`
      )
    }

    if (this.isLocalProvider(provider) && path.isAbsolute(normalizedModel)) {
      if (!FileHelper.isExistingPath(localModelCandidatePath)) {
        throw new Error(
          `The local model path "${normalizedModel}" was not found.`
        )
      }

      return normalizedModel
    }

    if (
      this.isLocalProvider(provider) &&
      !FileHelper.isExistingPath(localModelCandidatePath)
    ) {
      throw new Error(
        `The local model "${normalizedModel}" was not found in "${LLM_DIR_PATH}".`
      )
    }

    return `${provider}/${normalizedModel}`
  }

  public async setUnifiedTarget(rawTarget: string): Promise<void> {
    const normalizedRawTarget = rawTarget.trim()

    this.workflowTargetValue = normalizedRawTarget
    this.agentTargetValue = normalizedRawTarget
    this.workflowTarget = resolveTarget(normalizedRawTarget)
    this.agentTarget = resolveTarget(normalizedRawTarget)

    process.env[GLOBAL_LLM_ENV_KEY] = normalizedRawTarget

    await ProfileHelper.updateDotEnvVariable(
      GLOBAL_LLM_ENV_KEY,
      normalizedRawTarget
    )

    CONFIG_STATE_EVENT_EMITTER.emit(MODEL_CONFIGURATION_UPDATED_EVENT, {
      workflowTarget: this.workflowTarget,
      agentTarget: this.agentTarget,
      rawTarget: normalizedRawTarget
    })
  }
}
