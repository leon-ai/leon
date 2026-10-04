import { LLMProviders } from '@/core/llm-manager/types'

export interface LLMProviderAccountConfig {
  label: string
  value: LLMProviders
  apiKeyEnv: string
  apiKeyURL: string | null
  baseURL: string
  accountLabel?: string
  aliases?: string[]
  fellowAPIKeyEnvs?: string[]
}

/**
 * Shared provider account metadata used by both setup scripts and built-in
 * commands, fellow discovery, and inference clients. Keep endpoints and key
 * names here so they stay aligned across entry points.
 */
export const LLM_PROVIDER_ACCOUNT_CONFIGS: ReadonlyArray<LLMProviderAccountConfig> =
  Object.freeze([
    {
      label: 'OpenRouter',
      value: LLMProviders.OpenRouter,
      accountLabel: 'OpenRouter',
      baseURL: 'https://openrouter.ai/api/v1',
      fellowAPIKeyEnvs: ['OPENROUTER_API_KEY'],
      apiKeyEnv: 'LEON_OPENROUTER_API_KEY',
      apiKeyURL: 'https://openrouter.ai/settings/keys'
    },
    {
      label: 'OpenAI',
      value: LLMProviders.OpenAI,
      accountLabel: 'ChatGPT',
      baseURL: 'https://api.openai.com/v1',
      aliases: ['openai-codex'],
      fellowAPIKeyEnvs: ['OPENAI_API_KEY'],
      apiKeyEnv: 'LEON_OPENAI_API_KEY',
      apiKeyURL: 'https://platform.openai.com/api-keys'
    },
    {
      label: 'Anthropic',
      value: LLMProviders.Anthropic,
      baseURL: 'https://api.anthropic.com/v1',
      aliases: ['claude'],
      fellowAPIKeyEnvs: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
      apiKeyEnv: 'LEON_ANTHROPIC_API_KEY',
      apiKeyURL: 'https://console.anthropic.com/settings/keys'
    },
    {
      label: 'DeepSeek',
      value: LLMProviders.DeepSeek,
      baseURL: 'https://api.deepseek.com/v1',
      fellowAPIKeyEnvs: ['DEEPSEEK_API_KEY'],
      apiKeyEnv: 'LEON_DEEPSEEK_API_KEY',
      apiKeyURL: 'https://platform.deepseek.com/api_keys'
    },
    {
      label: 'Z.ai',
      value: LLMProviders.ZAI,
      baseURL: 'https://api.z.ai/api/paas/v4',
      aliases: ['z-ai', 'z'],
      fellowAPIKeyEnvs: ['ZAI_API_KEY', 'Z_AI_API_KEY'],
      apiKeyEnv: 'LEON_ZAI_API_KEY',
      apiKeyURL: 'https://z.ai/manage-apikey/apikey-list'
    },
    {
      label: 'MiniMax',
      value: LLMProviders.MiniMax,
      baseURL: 'https://api.minimax.io/v1',
      fellowAPIKeyEnvs: ['MINIMAX_API_KEY'],
      apiKeyEnv: 'LEON_MINIMAX_API_KEY',
      apiKeyURL: 'https://platform.minimax.io/user-center/basic-information/interface-key'
    },
    {
      label: 'MoonShot AI',
      value: LLMProviders.MoonshotAI,
      baseURL: 'https://api.moonshot.ai/v1',
      aliases: ['moonshot', 'moonshot-ai'],
      fellowAPIKeyEnvs: ['MOONSHOT_API_KEY'],
      apiKeyEnv: 'LEON_MOONSHOTAI_API_KEY',
      apiKeyURL: 'https://platform.moonshot.ai/console/api-keys'
    },
    {
      label: 'Groq',
      value: LLMProviders.Groq,
      baseURL: 'https://api.groq.com/openai/v1',
      fellowAPIKeyEnvs: ['GROQ_API_KEY'],
      apiKeyEnv: 'LEON_GROQ_API_KEY',
      apiKeyURL: 'https://console.groq.com/keys'
    },
    {
      label: 'Cerebras',
      value: LLMProviders.Cerebras,
      baseURL: 'https://api.cerebras.ai/v1',
      fellowAPIKeyEnvs: ['CEREBRAS_API_KEY'],
      apiKeyEnv: 'LEON_CEREBRAS_API_KEY',
      apiKeyURL: null
    },
    {
      label: 'Celeris',
      value: LLMProviders.Celeris,
      baseURL: 'https://inference.celeris.ai/celeris-1/v1',
      apiKeyEnv: 'LEON_CELERIS_API_KEY',
      apiKeyURL: 'https://console.celeris.ai'
    },
    {
      label: 'Hugging Face',
      value: LLMProviders.HuggingFace,
      baseURL: 'https://router.huggingface.co/v1',
      aliases: ['hugging-face'],
      fellowAPIKeyEnvs: ['HF_TOKEN'],
      apiKeyEnv: 'LEON_HUGGINGFACE_API_KEY',
      apiKeyURL: 'https://huggingface.co/settings/tokens'
    }
  ])

/**
 * Find provider account metadata by provider value.
 */
export function getLLMProviderAccountConfig(
  providerValue: string,
  apiKeyEnv?: string
): LLMProviderAccountConfig | undefined {
  const providerConfig = LLM_PROVIDER_ACCOUNT_CONFIGS.find(
    (providerConfig) => providerConfig.value === providerValue
  )

  if (!providerConfig) {
    return undefined
  }

  return apiKeyEnv ? { ...providerConfig, apiKeyEnv } : providerConfig
}

/**
 * Read defaults for a remote provider that must have registered metadata.
 */
export function getRequiredLLMProviderAccountConfig(
  provider: LLMProviders
): LLMProviderAccountConfig {
  const config = getLLMProviderAccountConfig(provider)

  if (!config) {
    throw new Error(`Missing provider account configuration for "${provider}".`)
  }

  return config
}
