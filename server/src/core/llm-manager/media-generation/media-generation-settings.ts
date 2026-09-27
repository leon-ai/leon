import { ToolkitConfig } from '@sdk/toolkit-config'
import { CONFIG_MANAGER } from '@/config'
import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { LLMProviders } from '@/core/llm-manager/types'
import { MediaKind } from './media-generation-types'
import { MEDIA_PROVIDERS } from './media-generation-catalog'

export interface GenerationSettings {
  provider: LLMProviders | 'inherit'
  model: string
  options: Record<string, unknown>
}

const TOOLKIT = 'media_generation'
const migrations = new Map<string, Promise<void>>()

/**
 * Moves legacy preferences once, preserving newer tool settings and only deleting
 * the old source after every destination has been saved successfully.
 */
async function migrateSettings(): Promise<void> {
  const profile = getActiveProfileName()
  const pending = migrations.get(profile)

  if (pending) {
    return pending
  }

  const task = (async (): Promise<void> => {
    const llm = CONFIG_MANAGER.getConfig().llm as unknown as {
      media_generation?: Partial<Record<MediaKind, GenerationSettings>>
    }

    if (!llm.media_generation) {
      return
    }

    for (const kind of Object.values(MediaKind)) {
      const legacy = llm.media_generation[kind]

      if (!legacy) {
        continue
      }

      const current = ToolkitConfig.loadToolSettings(
        TOOLKIT,
        kind,
        {},
        true,
        profile
      )

      if (current['provider'] === 'inherit' && current['model'] === 'auto') {
        ToolkitConfig.saveToolSettings(
          TOOLKIT,
          kind,
          {
            ...legacy,
            options: {
              ...legacy.options,
              ...(current['options'] as Record<string, unknown>)
            }
          },
          profile
        )
      }
    }

    await CONFIG_MANAGER.deleteValue(['llm', 'media_generation'])
  })()

  migrations.set(profile, task)
  try {
    await task
  } finally {
    migrations.delete(profile)
  }
}

function validateSettings(kind: MediaKind, settings: GenerationSettings): void {
  if (
    settings.provider !== 'inherit' &&
    !MEDIA_PROVIDERS[settings.provider]?.kinds.includes(kind)
  ) {
    throw new Error(
      `Provider ${settings.provider} does not support ${kind} generation.`
    )
  }

  if (typeof settings.model !== 'string' || !settings.model.trim()) {
    throw new Error('Choose a model or use auto.')
  }

  // Pinning a model while inheriting a changing chat provider can send it to the wrong account.
  if (settings.provider === 'inherit' && settings.model !== 'auto') {
    throw new Error(
      'Choose an explicit provider when pinning a generation model.'
    )
  }

  if (
    !settings.options ||
    typeof settings.options !== 'object' ||
    Array.isArray(settings.options)
  ) {
    throw new Error('Generation options must be an object.')
  }
}

/**
 * Loads fresh owner settings through the existing profile-aware SDK facilities.
 */
export async function readGenerationSettings(
  kind: MediaKind
): Promise<GenerationSettings> {
  await migrateSettings()
  const settings = ToolkitConfig.loadToolSettings(
    TOOLKIT,
    kind,
    {},
    true,
    getActiveProfileName()
  ) as unknown as GenerationSettings

  validateSettings(kind, settings)

  return settings
}

/**
 * Saves an explicitly requested preference; credentials stay in provider config.
 */
export async function saveGenerationSettings(
  kind: MediaKind,
  settings: GenerationSettings
): Promise<GenerationSettings> {
  validateSettings(kind, settings)
  await migrateSettings()
  ToolkitConfig.saveToolSettings(
    TOOLKIT,
    kind,
    { ...settings },
    getActiveProfileName()
  )

  return settings
}
