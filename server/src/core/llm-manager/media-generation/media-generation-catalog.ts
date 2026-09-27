import { CONFIG_MANAGER } from '@/config'
import { LLMProviders } from '@/core/llm-manager/types'
import { MediaKind } from './media-generation-types'

// Required provider parameters belong to the same catalog as model recommendations.
export const DEFAULT_GENERATION_OPTIONS: Partial<
  Record<LLMProviders, Partial<Record<MediaKind, Record<string, unknown>>>>
> = {
  [LLMProviders.OpenAI]: { audio: { voice: 'coral' } },
  [LLMProviders.Groq]: { audio: { voice: 'troy', response_format: 'wav' } },
  [LLMProviders.MiniMax]: {
    audio: { voice_setting: { voice_id: 'English_expressive_narrator' } }
  }
}

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
    base_url: 'https://api.openai.com/v1',
    kinds: [MediaKind.Image, MediaKind.Audio, MediaKind.Document],
    models: {
      image: ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'],
      audio: ['gpt-4o-mini-tts'],
      document: ['gpt-6-astra']
    }
  },
  [LLMProviders.Anthropic]: {
    base_url: 'https://api.anthropic.com/v1',
    kinds: [MediaKind.Document],
    models: { document: ['claude-opus-5-5'] }
  },
  [LLMProviders.OpenRouter]: {
    base_url: 'https://openrouter.ai/api/v1',
    kinds: [MediaKind.Image, MediaKind.Video, MediaKind.Audio],
    models: {
      image: ['google/gemini-3.1-flash-image'],
      video: ['google/veo-3.1']
    }
  },
  [LLMProviders.ZAI]: {
    base_url: 'https://api.z.ai/api/paas/v4',
    kinds: [MediaKind.Image, MediaKind.Video],
    models: { image: ['glm-image'], video: ['cogvideox-3'] }
  },
  [LLMProviders.MiniMax]: {
    base_url: 'https://api.minimax.io/v1',
    kinds: [MediaKind.Image, MediaKind.Video, MediaKind.Audio],
    models: {
      image: ['image-01'],
      video: ['MiniMax-Hailuo-2.3'],
      audio: ['speech-2.8-hd', 'music-3.0']
    }
  },
  [LLMProviders.Groq]: {
    base_url: 'https://api.groq.com/openai/v1',
    kinds: [MediaKind.Audio],
    models: {
      audio: [
        'canopylabs/orpheus-v1-english',
        'canopylabs/orpheus-arabic-saudi'
      ]
    }
  },
  [LLMProviders.HuggingFace]: {
    base_url: 'https://router.huggingface.co',
    kinds: [MediaKind.Image, MediaKind.Video, MediaKind.Audio],
    models: {}
  },
  [LLMProviders.SGLang]: {
    base_url: '',
    kinds: [MediaKind.Image, MediaKind.Video],
    models: {}
  }
}

/**
 * Exposes supported operations without claiming that an account has model access.
 */
export function listMediaCapabilities(): Array<Record<string, unknown>> {
  return Object.values(LLMProviders).map((provider) => ({
    provider,
    kinds: MEDIA_PROVIDERS[provider]?.kinds || [],
    models: MEDIA_PROVIDERS[provider]?.models || {},
    configured:
      provider === LLMProviders.SGLang
        ? Boolean(CONFIG_MANAGER.getProviderGenerationBaseURL(provider))
        : Boolean(CONFIG_MANAGER.getProviderAPIKey(provider)),
    ...(provider === LLMProviders.OpenAI
      ? {
          example_options: DEFAULT_GENERATION_OPTIONS[provider],
          hosted_image: {
            model: 'gpt-6-astra',
            options: { mode: 'hosted', image_model: 'gpt-image-2.5-flare' }
          }
        }
      : {}),
    ...(provider === LLMProviders.Groq
      ? { example_options: DEFAULT_GENERATION_OPTIONS[provider] }
      : {}),
    ...(provider === LLMProviders.MiniMax
      ? {
          example_options: DEFAULT_GENERATION_OPTIONS[provider],
          music_access:
            'Existing eligible accounts only; set options.mode to music.'
        }
      : {}),
    ...(provider === LLMProviders.SGLang
      ? { requirement: 'A deployed SGLang Diffusion endpoint.' }
      : {}),
    ...(provider === LLMProviders.LlamaCPP
      ? {
          requirement:
            'Use the existing local speech tools; the managed chat server has no generation endpoint.'
        }
      : {})
  }))
}
