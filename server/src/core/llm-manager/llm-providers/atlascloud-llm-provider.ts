import { getRequiredLLMProviderAccountConfig } from '@/core/llm-manager/llm-provider-account-configs'
import { LLMProviders } from '@/core/llm-manager/types'
import AISDKRemoteLLMProvider from '@/core/llm-manager/llm-providers/ai-sdk-remote-llm-provider'
import type { ResolvedLLMTarget } from '@/core/llm-manager/llm-routing'

const PROVIDER_CONFIG = getRequiredLLMProviderAccountConfig(LLMProviders.AtlasCloud)

/**
 * Atlas Cloud is a multi-vendor OpenAI-compatible gateway. Model ids use the
 * `vendor/model` form listed by its models endpoint.
 *
 * @see https://api.atlascloud.ai/v1/models
 */
export default class AtlasCloudLLMProvider extends AISDKRemoteLLMProvider {
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
