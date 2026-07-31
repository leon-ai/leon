import { CONFIG_MANAGER } from '@/config'
import type { ResolvedLLMTarget } from '@/core/llm-manager/llm-routing'
import {
  getLLMModelCatalogEntry,
  type LLMModelReasoning,
  type LLMModelSpeed
} from '@/core/llm-manager/llm-model-catalog'

const DEFAULT_REASONING: LLMModelReasoning = 'auto'
const DEFAULT_SPEED: LLMModelSpeed = 'auto'

export interface LLMModelSettings {
  reasoning: LLMModelReasoning
  speed: LLMModelSpeed
}

type LLMModelSettingName = keyof LLMModelSettings

function getTargetKey(target: ResolvedLLMTarget): string {
  if (!target.isEnabled || !target.isResolved || !target.provider || !target.model) {
    throw new Error('The active agent model is not configured.')
  }

  return target.label
}

/** Manages persisted reasoning and speed overrides for each model target. */
export class ModelSettingsState {
  public getSettings(target: ResolvedLLMTarget): LLMModelSettings {
    if (!target.isEnabled || !target.isResolved || !target.provider || !target.model) {
      return {
        reasoning: DEFAULT_REASONING,
        speed: DEFAULT_SPEED
      }
    }

    const configuredSettings = CONFIG_MANAGER.getConfig().llm.model_settings[
      target.label
    ]
    const availableReasoning = this.getAvailableReasoning(target)
    const availableSpeed = this.getAvailableSpeed(target)

    return {
      reasoning: availableReasoning.includes(
        configuredSettings?.reasoning as LLMModelReasoning
      )
        ? configuredSettings?.reasoning as LLMModelReasoning
        : DEFAULT_REASONING,
      speed: availableSpeed.includes(configuredSettings?.speed as LLMModelSpeed)
        ? configuredSettings?.speed as LLMModelSpeed
        : DEFAULT_SPEED
    }
  }

  public getAvailableReasoning(
    target: ResolvedLLMTarget
  ): readonly LLMModelReasoning[] {
    return getLLMModelCatalogEntry(target.provider, target.model)?.reasoning || [
      DEFAULT_REASONING
    ]
  }

  public getAvailableSpeed(
    target: ResolvedLLMTarget
  ): readonly LLMModelSpeed[] {
    return getLLMModelCatalogEntry(target.provider, target.model)?.speed || [
      DEFAULT_SPEED
    ]
  }

  public async setReasoning(
    target: ResolvedLLMTarget,
    reasoning: LLMModelReasoning
  ): Promise<void> {
    if (!this.getAvailableReasoning(target).includes(reasoning)) {
      throw new Error(
        `Reasoning "${reasoning}" is not supported by "${getTargetKey(target)}".`
      )
    }

    await this.setSetting(target, 'reasoning', reasoning)
  }

  public async setSpeed(
    target: ResolvedLLMTarget,
    speed: LLMModelSpeed
  ): Promise<void> {
    if (!this.getAvailableSpeed(target).includes(speed)) {
      throw new Error(
        `Speed "${speed}" is not supported by "${getTargetKey(target)}".`
      )
    }

    await this.setSetting(target, 'speed', speed)
  }

  private async setSetting<TName extends LLMModelSettingName>(
    target: ResolvedLLMTarget,
    name: TName,
    value: LLMModelSettings[TName]
  ): Promise<void> {
    const targetKey = getTargetKey(target)
    const modelSettings = {
      ...CONFIG_MANAGER.getConfig().llm.model_settings
    }
    const targetSettings = {
      ...modelSettings[targetKey]
    }

    if (value === 'auto') {
      delete targetSettings[name]
    } else {
      targetSettings[name] = value
    }

    if (Object.keys(targetSettings).length === 0) {
      delete modelSettings[targetKey]
    } else {
      modelSettings[targetKey] = targetSettings
    }

    await CONFIG_MANAGER.setValue(['llm', 'model_settings'], modelSettings)
  }
}
