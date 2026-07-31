import {
  getLLMProviderAccountConfig
} from '@/core/llm-manager/llm-provider-account-configs'
import {
  getLLMModelCatalogEntries,
  getLLMModelCatalogProviders
} from '@/core/llm-manager/llm-model-catalog'

import { SetupUI, setupConsola } from './setup-ui'

const REMOTE_LLM_PROVIDERS = getLLMModelCatalogProviders().map((provider) => ({
  ...getRequiredProviderAccountConfig(provider),
  models: getLLMModelCatalogEntries(provider).map((entry) => ({
    label: `${entry.label}${entry.recommended ? ' (Recommended)' : ''}`,
    value: entry.model
  }))
}))

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
