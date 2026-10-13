import { ToolkitConfig } from '@sdk/toolkit-config'
import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { LLMProviders } from '@/core/llm-manager/types'
import { MediaKind } from './media-generation-types'
import { MEDIA_PROVIDERS } from './media-generation-catalog'

export interface GenerationSettings {
  provider: LLMProviders | 'inherit'
  model: string
  options: Record<string, unknown>
}

const GENERATION_TOOLKITS: Record<MediaKind, string> = {
  [MediaKind.Image]: 'media_production',
  [MediaKind.Document]: 'document'
}

/**
 * Resolves settings in the toolkit that owns each generation tool.
 */
export function getGenerationToolkit(kind: MediaKind): string {
  return GENERATION_TOOLKITS[kind]
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
  const settings = ToolkitConfig.loadToolSettings(
    getGenerationToolkit(kind),
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
  ToolkitConfig.saveToolSettings(
    getGenerationToolkit(kind),
    kind,
    { ...settings },
    getActiveProfileName()
  )

  return settings
}
