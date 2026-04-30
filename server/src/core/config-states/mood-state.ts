import { LEON_MOOD } from '@/constants'
import {
  CONFIG_STATE_EVENT_EMITTER,
  MOOD_CONFIGURATION_UPDATED_EVENT
} from '@/core/config-states/config-state-event-emitter'
import { ProfileHelper } from '@/helpers/profile-helper'
import { Moods } from '@/types'

const DEFAULT_CONFIGURED_MOOD = 'auto'
const MOOD_ENV_KEY = 'LEON_MOOD'
const SUPPORTED_MOOD_VALUES = [
  DEFAULT_CONFIGURED_MOOD,
  Moods.Default,
  Moods.Tired,
  Moods.Cocky,
  Moods.Sad,
  Moods.Angry
] as const

export type ConfiguredMood = (typeof SUPPORTED_MOOD_VALUES)[number]

export function normalizeConfiguredMood(
  configuredMood: string | null | undefined
): ConfiguredMood | null {
  const normalizedConfiguredMood = String(configuredMood || '')
    .trim()
    .toLowerCase()

  return SUPPORTED_MOOD_VALUES.includes(
    normalizedConfiguredMood as ConfiguredMood
  )
    ? (normalizedConfiguredMood as ConfiguredMood)
    : null
}

export function pickAutomaticMood(input?: {
  date?: Date
  random?: number
}): Moods {
  const date = input?.date || new Date()
  const day = date.getDay()
  const hour = date.getHours()
  const random = input?.random ?? Math.random()

  if (hour >= 13 && hour <= 14 && random < 0.5) {
    return Moods.Tired
  }

  if (day === 0 && random < 0.2) {
    return Moods.Sad
  }

  if (day === 5 && random < 0.8) {
    return Moods.Default
  }

  if (day === 6 && random < 0.25) {
    return Moods.Cocky
  }

  if (day === 1 && random < 0.25) {
    return Moods.Tired
  }

  if (hour >= 23 || hour < 6) {
    return random < 0.33 ? Moods.Tired : Moods.Default
  }

  if (Math.random() < 0.75) {
    return Moods.Default
  }

  return Object.values(Moods)[Math.floor(Math.random() * Object.values(Moods).length)] || Moods.Default
}

export class MoodState {
  private configuredMood: ConfiguredMood =
    normalizeConfiguredMood(LEON_MOOD) || DEFAULT_CONFIGURED_MOOD

  private currentMood: Moods =
    this.configuredMood === DEFAULT_CONFIGURED_MOOD
      ? pickAutomaticMood()
      : this.configuredMood

  public getConfiguredMood(): ConfiguredMood {
    return this.configuredMood
  }

  public getCurrentMood(): Moods {
    return this.currentMood
  }

  public getSupportedMoodValues(): ConfiguredMood[] {
    return [...SUPPORTED_MOOD_VALUES]
  }

  public isAutomatic(): boolean {
    return this.configuredMood === DEFAULT_CONFIGURED_MOOD
  }

  public async setConfiguredMood(
    configuredMood: string
  ): Promise<ConfiguredMood> {
    const normalizedConfiguredMood = normalizeConfiguredMood(configuredMood)

    if (!normalizedConfiguredMood) {
      throw new Error(`Unsupported mood "${configuredMood}".`)
    }

    this.configuredMood = normalizedConfiguredMood
    this.currentMood =
      normalizedConfiguredMood === DEFAULT_CONFIGURED_MOOD
        ? pickAutomaticMood()
        : normalizedConfiguredMood
    process.env[MOOD_ENV_KEY] = normalizedConfiguredMood

    await ProfileHelper.updateDotEnvVariable(
      MOOD_ENV_KEY,
      normalizedConfiguredMood
    )

    CONFIG_STATE_EVENT_EMITTER.emit(MOOD_CONFIGURATION_UPDATED_EVENT, {
      configuredMood: this.configuredMood,
      currentMood: this.currentMood
    })

    return normalizedConfiguredMood
  }

  public syncCurrentMood(currentMood: Moods): void {
    this.currentMood = currentMood
  }
}
