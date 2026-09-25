import { LLMProviders } from '@/core/llm-manager/types'
import { getRequiredLLMProviderAccountConfig } from '@/core/llm-manager/llm-provider-account-configs'
import AISDKRemoteLLMProvider from '@/core/llm-manager/llm-providers/ai-sdk-remote-llm-provider'
import type { ResolvedLLMTarget } from '@/core/llm-manager/llm-routing'

const PROVIDER_CONFIG = getRequiredLLMProviderAccountConfig(LLMProviders.Requesty)

/**
 * Requesty is an OpenAI-compatible gateway. The base URL can point to a
 * regional router such as https://router.eu.requesty.ai/v1.
 * @see https://docs.requesty.ai
 */
export default class RequestyLLMProvider extends AISDKRemoteLLMProvider {
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
      flavor: 'openai-compatible'
    })
  }
}
