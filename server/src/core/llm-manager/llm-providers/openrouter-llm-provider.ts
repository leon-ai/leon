import { LLMProviders } from '@/core/llm-manager/types'
import { getRequiredLLMProviderAccountConfig } from '@/core/llm-manager/llm-provider-account-configs'
import AISDKRemoteLLMProvider from '@/core/llm-manager/llm-providers/ai-sdk-remote-llm-provider'
import type { ResolvedLLMTarget } from '@/core/llm-manager/llm-routing'

const PROVIDER_CONFIG = getRequiredLLMProviderAccountConfig(LLMProviders.OpenRouter)

export default class OpenRouterLLMProvider extends AISDKRemoteLLMProvider {
  constructor(target: ResolvedLLMTarget) {
    super({
      credentials: target.accountCredentials,
      name: `${PROVIDER_CONFIG.label} LLM Provider`,
      providerName: PROVIDER_CONFIG.value,
      apiKeyEnv: PROVIDER_CONFIG.apiKeyEnv,
      model: target.model,
      baseURL: AISDKRemoteLLMProvider.resolveBaseURL(
        PROVIDER_CONFIG,
        target.accountCredentials
      ),
      flavor: 'openrouter'
    })
  }
}
