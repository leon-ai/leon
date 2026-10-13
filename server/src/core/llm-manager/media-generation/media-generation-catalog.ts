import { hasProviderConnection } from '../provider-requests'
import { getRequiredLLMProviderAccountConfig } from '@/core/llm-manager/llm-provider-account-configs'
import { CONFIG_MANAGER } from '@/config'
import { LLMProviders } from '@/core/llm-manager/types'
import { MediaKind } from './media-generation-types'
import { getModelAccountCredentials } from '../llm-accounts'
import { CHATGPT_CODEX_DEFAULT_IMAGE_MODEL } from '../llm-accounts/chatgpt-account-config'

/**
 * Endpoint capabilities are distinct from the text-model catalog. Model access
 * is still checked by the provider; image understanding never implies output.
 */
export const MEDIA_PROVIDERS: Partial<
  Record<
    LLMProviders,
    {
      base_url: string
      kinds: MediaKind[]
      models: Partial<Record<MediaKind, string[]>>
    }
  >
> = {
  [LLMProviders.OpenAI]: {
    base_url: getRequiredLLMProviderAccountConfig(LLMProviders.OpenAI).baseURL,
    kinds: [MediaKind.Image, MediaKind.Document],
    models: {
      image: ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'],
      document: ['gpt-6-astra']
    }
  },
  [LLMProviders.Anthropic]: {
    base_url: getRequiredLLMProviderAccountConfig(LLMProviders.Anthropic).baseURL,
    kinds: [MediaKind.Document],
    models: { document: ['claude-opus-5-5'] }
  },
  [LLMProviders.OpenRouter]: {
    base_url: getRequiredLLMProviderAccountConfig(LLMProviders.OpenRouter).baseURL,
    kinds: [MediaKind.Image],
    models: {
      image: ['google/gemini-3.1-flash-image']
    }
  },
  [LLMProviders.ZAI]: {
    base_url: getRequiredLLMProviderAccountConfig(LLMProviders.ZAI).baseURL,
    kinds: [MediaKind.Image],
    models: { image: ['glm-image'] }
  },
  [LLMProviders.MiniMax]: {
    base_url: getRequiredLLMProviderAccountConfig(LLMProviders.MiniMax).baseURL,
    kinds: [MediaKind.Image],
    models: {
      image: ['image-01']
    }
  },
  [LLMProviders.HuggingFace]: {
    base_url: new URL(
      getRequiredLLMProviderAccountConfig(LLMProviders.HuggingFace).baseURL
    ).origin,
    kinds: [MediaKind.Image],
    models: {}
  },
  [LLMProviders.SGLang]: {
    base_url: '',
    kinds: [MediaKind.Image],
    models: {}
  }
}

/**
 * Resolves operations for the selected credential rather than a spare API key.
 */
export async function getMediaProviderCapabilities(provider: LLMProviders): Promise<{
  kinds: MediaKind[]
  models: Partial<Record<MediaKind, string[]>>
  configured: boolean
  auth_kind?: string
  requirement?: string
}> {
  const capabilities = {
    kinds: MEDIA_PROVIDERS[provider]?.kinds || [],
    models: MEDIA_PROVIDERS[provider]?.models || {},
    configured:
      provider === LLMProviders.SGLang
        ? Boolean(CONFIG_MANAGER.getProviderGenerationBaseURL(provider))
        : hasProviderConnection(provider)
  }
  if (provider !== LLMProviders.OpenAI) {
    return capabilities
  }

  try {
    const credentials = await getModelAccountCredentials(provider)
    if (credentials?.['auth_kind'] === 'chatgpt') {
      return {
        kinds: [MediaKind.Image],
        models: {
          // Recommend a default without restricting owner-selected models.
          image: [CHATGPT_CODEX_DEFAULT_IMAGE_MODEL]
        },
        configured: true,
        auth_kind: 'chatgpt'
      }
    }
  } catch (error) {
    return {
      ...capabilities,
      configured: false,
      requirement: error instanceof Error ? error.message : String(error)
    }
  }

  return capabilities
}

/**
 * Exposes supported operations without claiming that an account has model access.
 */
export async function listMediaCapabilities(): Promise<Array<Record<string, unknown>>> {
  return Promise.all(Object.values(LLMProviders).map(async (provider) => {
    const capabilities = await getMediaProviderCapabilities(provider)

    return {
      provider,
      ...capabilities,
      ...(provider === LLMProviders.OpenAI && capabilities.auth_kind !== 'chatgpt'
        ? {
            hosted_image: {
              model: 'gpt-6-astra',
              options: { mode: 'hosted', image_model: 'gpt-image-2.5-flare' }
            }
          }
        : {}),
      ...(provider === LLMProviders.SGLang
        ? { requirement: 'A deployed SGLang Diffusion endpoint.' }
        : {}),
      ...(provider === LLMProviders.LlamaCPP
        ? {
            requirement:
              'The managed chat server has no image or document generation endpoint.'
          }
        : {})
    }
  }))
}
