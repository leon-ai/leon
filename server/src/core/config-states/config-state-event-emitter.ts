import { EventEmitter } from 'node:events'

export const MOOD_CONFIGURATION_UPDATED_EVENT =
  'mood_configuration_updated'
export const MODEL_CONFIGURATION_UPDATED_EVENT =
  'model_configuration_updated'

export const CONFIG_STATE_EVENT_EMITTER = new EventEmitter()
