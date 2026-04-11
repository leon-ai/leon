import { LLMProviders } from '@/core/llm-manager/types'

export interface LLMProviderAccountConfig {
  label: string
  value: LLMProviders
  apiKeyEnv: string
  apiKeyURL: string | null
}

/**
 * Shared provider account metadata used by both setup scripts and built-in
 * commands. Keep provider API key env names and creation URLs here so they
 * stay aligned across entry points.
 */
export const LLM_PROVIDER_ACCOUNT_CONFIGS: ReadonlyArray<LLMProviderAccountConfig> =
  Object.freeze([
    {
      label: 'OpenRouter',
      value: LLMProviders.OpenRouter,
      apiKeyEnv: 'LEON_OPENROUTER_API_KEY',
      apiKeyURL: 'https://openrouter.ai/settings/keys'
    },
    {
      label: 'OpenAI',
      value: LLMProviders.OpenAI,
      apiKeyEnv: 'LEON_OPENAI_API_KEY',
      apiKeyURL: 'https://platform.openai.com/api-keys'
    },
    {
      label: 'Anthropic',
      value: LLMProviders.Anthropic,
      apiKeyEnv: 'LEON_ANTHROPIC_API_KEY',
      apiKeyURL: 'https://console.anthropic.com/settings/keys'
    },
    {
      label: 'Z.AI',
      value: LLMProviders.ZAI,
      apiKeyEnv: 'LEON_ZAI_API_KEY',
      apiKeyURL: 'https://z.ai/manage-apikey/apikey-list'
    },
    {
      label: 'Moonshot AI',
      value: LLMProviders.MoonshotAI,
      apiKeyEnv: 'LEON_MOONSHOTAI_API_KEY',
      apiKeyURL: 'https://platform.moonshot.ai/console/api-keys'
    },
    {
      label: 'Groq',
      value: LLMProviders.Groq,
      apiKeyEnv: 'LEON_GROQ_API_KEY',
      apiKeyURL: 'https://console.groq.com/keys'
    },
    {
      label: 'Cerebras',
      value: LLMProviders.Cerebras,
      apiKeyEnv: 'LEON_CEREBRAS_API_KEY',
      apiKeyURL: null
    },
    {
      label: 'Hugging Face',
      value: LLMProviders.HuggingFace,
      apiKeyEnv: 'LEON_HUGGINGFACE_API_KEY',
      apiKeyURL: 'https://huggingface.co/settings/tokens'
    }
  ])

/**
 * Find provider account metadata by provider value.
 */
export function getLLMProviderAccountConfig(
  providerValue: string
): LLMProviderAccountConfig | undefined {
  return LLM_PROVIDER_ACCOUNT_CONFIGS.find(
    (providerConfig) => providerConfig.value === providerValue
  )
}
