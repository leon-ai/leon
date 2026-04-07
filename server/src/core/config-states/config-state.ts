import { MoodState } from '@/core/config-states/mood-state'
import { ModelState } from '@/core/config-states/model-state'
import { RoutingModeState } from '@/core/config-states/routing-mode-state'

class ConfigState {
  private readonly moodState = new MoodState()
  private readonly modelState = new ModelState()
  private readonly routingModeState = new RoutingModeState()

  public getMoodState(): MoodState {
    return this.moodState
  }

  public getModelState(): ModelState {
    return this.modelState
  }

  public getRoutingModeState(): RoutingModeState {
    return this.routingModeState
  }
}

export const CONFIG_STATE = new ConfigState()
