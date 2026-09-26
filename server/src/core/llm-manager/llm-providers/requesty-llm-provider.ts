import AISDKRemoteLLMProvider from '@/core/llm-manager/llm-providers/ai-sdk-remote-llm-provider'
import type { ResolvedLLMTarget } from '@/core/llm-manager/llm-routing'
import { CONFIG_MANAGER } from '@/config'

const DEFAULT_BASE_URL = 'https://router.requesty.ai/v1'

/**
 * Requesty is an OpenAI-compatible gateway. The base URL can point to a
 * regional router such as https://router.eu.requesty.ai/v1.
 * @see https://docs.requesty.ai
 */
export default class RequestyLLMProvider extends AISDKRemoteLLMProvider {
  constructor(target: ResolvedLLMTarget) {
    super({
      name: 'Requesty LLM Provider',
      providerName: 'requesty',
      apiKeyEnv: 'LEON_REQUESTY_API_KEY',
      model: target.model,
      baseURL:
        CONFIG_MANAGER.getProviderBaseURL('requesty') || DEFAULT_BASE_URL,
      flavor: 'openai-compatible'
    })
  }
}
