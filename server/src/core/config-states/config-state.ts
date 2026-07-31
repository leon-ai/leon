import { MoodState } from '@/core/config-states/mood-state'
import { ModelState } from '@/core/config-states/model-state'
import { ModelSettingsState } from '@/core/config-states/model-settings-state'
import { RoutingModeState } from '@/core/config-states/routing-mode-state'
import { getActiveProfileName } from '@/core/profile-runtime/profile-context'

export class ConfigState {
  private readonly moodState = new MoodState()
  private readonly modelState = new ModelState()
  private readonly modelSettingsState = new ModelSettingsState()
  private readonly routingModeState = new RoutingModeState()

  public getMoodState(): MoodState {
    return this.moodState
  }

  public getModelState(): ModelState {
    return this.modelState
  }

  public getModelSettingsState(): ModelSettingsState {
    return this.modelSettingsState
  }

  public getRoutingModeState(): RoutingModeState {
    return this.routingModeState
  }
}

class ProfileConfigState {
  private readonly states = new Map<string, ConfigState>()

  private getState(): ConfigState {
    const profileName = getActiveProfileName()
    const existingState = this.states.get(profileName)

    if (existingState) {
      return existingState
    }

    const state = new ConfigState()

    this.states.set(profileName, state)

    return state
  }

  public getMoodState(): MoodState {
    return this.getState().getMoodState()
  }

  public getModelState(): ModelState {
    return this.getState().getModelState()
  }

  public getModelSettingsState(): ModelSettingsState {
    return this.getState().getModelSettingsState()
  }

  public getRoutingModeState(): RoutingModeState {
    return this.getState().getRoutingModeState()
  }
}

export const CONFIG_STATE = new ProfileConfigState()
