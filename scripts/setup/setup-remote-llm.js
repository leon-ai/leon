import {
  getLLMProviderAccountConfig
} from '@/core/llm-manager/llm-provider-account-configs'

import { SetupUI, setupConsola } from './setup-ui'

const REMOTE_LLM_PROVIDERS = [
  {
    ...getRequiredProviderAccountConfig('openrouter'),
    models: [
      { label: 'openai/gpt-5.6-sol (Recommended)', value: 'openai/gpt-5.6-sol' },
      { label: 'openai/gpt-5.6-terra', value: 'openai/gpt-5.6-terra' },
      { label: 'openai/gpt-5.6-luna', value: 'openai/gpt-5.6-luna' },
      { label: 'openai/gpt-5.5', value: 'openai/gpt-5.5' },
      { label: 'openai/gpt-5.4', value: 'openai/gpt-5.4' },
      { label: 'openai/gpt-5.4-mini', value: 'openai/gpt-5.4-mini' },
      {
        label: 'anthropic/claude-fable-5',
        value: 'anthropic/claude-fable-5'
      },
      {
        label: 'anthropic/claude-opus-4.8',
        value: 'anthropic/claude-opus-4.8'
      },
      {
        label: 'anthropic/claude-opus-4.7',
        value: 'anthropic/claude-opus-4.7'
      },
      {
        label: 'anthropic/claude-opus-4.6',
        value: 'anthropic/claude-opus-4.6'
      },
      {
        label: 'anthropic/claude-sonnet-4.6',
        value: 'anthropic/claude-sonnet-4.6'
      },
      { label: 'xiaomi/mimo-v2.5-pro', value: 'xiaomi/mimo-v2.5-pro' },
      { label: 'z-ai/glm-5.2', value: 'z-ai/glm-5.2' },
      { label: 'z-ai/glm-5.1', value: 'z-ai/glm-5.1' },
      { label: 'z-ai/glm-5-turbo', value: 'z-ai/glm-5-turbo' },
      { label: 'moonshotai/kimi-k3', value: 'moonshotai/kimi-k3' },
      { label: 'moonshotai/kimi-k2.6', value: 'moonshotai/kimi-k2.6' },
      { label: 'minimax/minimax-m3', value: 'minimax/minimax-m3' }
    ]
  },
  {
    ...getRequiredProviderAccountConfig('openai'),
    models: [
      { label: 'GPT-5.6 Sol (Recommended)', value: 'gpt-5.6-sol' },
      { label: 'GPT-5.6 Terra', value: 'gpt-5.6-terra' },
      { label: 'GPT-5.6 Luna', value: 'gpt-5.6-luna' },
      { label: 'GPT-5.5', value: 'gpt-5.5' },
      { label: 'GPT-5.4', value: 'gpt-5.4' },
      { label: 'GPT-5.4 mini', value: 'gpt-5.4-mini' },
      { label: 'GPT-5.4 nano', value: 'gpt-5.4-nano' }
    ]
  },
  {
    ...getRequiredProviderAccountConfig('anthropic'),
    models: [
      { label: 'Claude Opus 4.8 (Recommended)', value: 'claude-opus-4-8' },
      { label: 'Claude Fable 5', value: 'claude-fable-5' },
      { label: 'Claude Opus 4.7', value: 'claude-opus-4-7' },
      { label: 'Claude Opus 4.6', value: 'claude-opus-4-6' },
      { label: 'Claude Sonnet 4.6', value: 'claude-sonnet-4-6' },
      { label: 'Claude Haiku 4.5', value: 'claude-haiku-4-5' }
    ]
  },
  {
    ...getRequiredProviderAccountConfig('zai'),
    models: [
      { label: 'GLM-5.2 (Recommended)', value: 'glm-5.2' },
      { label: 'GLM-5.1', value: 'glm-5.1' },
      { label: 'GLM-5-Turbo', value: 'glm-5-turbo' },
      { label: 'GLM-5', value: 'glm-5' }
    ]
  },
  {
    ...getRequiredProviderAccountConfig('minimax'),
    models: [
      { label: 'MiniMax-M3 (Recommended)', value: 'MiniMax-M3' },
      { label: 'MiniMax-M2.7', value: 'MiniMax-M2.7' }
    ]
  },
  {
    ...getRequiredProviderAccountConfig('moonshotai'),
    models: [
      { label: 'Kimi K3 (Recommended)', value: 'kimi-k3' },
      { label: 'Kimi K2.6', value: 'kimi-k2.6' },
      { label: 'Kimi K2.5', value: 'kimi-k2.5' }
    ]
  }
]

function getRequiredProviderAccountConfig(providerValue) {
  const providerAccountConfig = getLLMProviderAccountConfig(providerValue)

  if (!providerAccountConfig || !providerAccountConfig.apiKeyURL) {
    throw new Error(
      `Missing provider account configuration for "${providerValue}".`
    )
  }

  return providerAccountConfig
}

function getProviderOptions() {
  return REMOTE_LLM_PROVIDERS.map((provider) => ({
    label: provider.label,
    value: provider.value
  }))
}

function getProviderConfig(providerValue) {
  return REMOTE_LLM_PROVIDERS.find(
    (provider) => provider.value === providerValue
  )
}

/**
 * Ask for a remote LLM provider, model, and API key when local AI is skipped.
 */
export default async function setupRemoteLLM() {
  SetupUI.info(
    'No problem. I can use an online AI service instead.'
  )
  SetupUI.info(
    'I just need 3 quick details so I can connect it for you.'
  )

  const providerValue = await setupConsola.prompt(
    'Which online AI service should I use?',
    {
      type: 'select',
      initial: REMOTE_LLM_PROVIDERS[0].value,
      options: getProviderOptions(),
      cancel: 'default'
    }
  )
  const provider = getProviderConfig(providerValue)

  if (!provider) {
    throw new Error(`Unsupported remote LLM provider "${providerValue}".`)
  }

  const modelValue = await setupConsola.prompt(
    `Which model should I use with ${provider.label}?`,
    {
      type: 'select',
      initial: provider.models[0].value,
      options: provider.models,
      cancel: 'default'
    }
  )

  SetupUI.info(
    `Create your API key here: ${SetupUI.underlined(provider.apiKeyURL)}`
  )
  const apiKey = await setupConsola.prompt(
    `Paste your ${provider.label} API key. I will save it in your local .env file.`,
    {
      type: 'text',
      placeholder: 'Paste API key here',
      validate(value) {
        if (!value || value.trim() === '') {
          return 'Please paste your API key.'
        }
      },
      cancel: 'default'
    }
  )

  return {
    remoteLLMProvider: provider.value,
    remoteLLMModel: modelValue,
    remoteLLMAPIKeyEnv: provider.apiKeyEnv,
    remoteLLMAPIKey: apiKey
  }
}
