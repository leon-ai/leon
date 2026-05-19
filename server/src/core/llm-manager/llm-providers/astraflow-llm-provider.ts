import AISDKRemoteLLMProvider from '@/core/llm-manager/llm-providers/ai-sdk-remote-llm-provider'
import type { ResolvedLLMTarget } from '@/core/llm-manager/llm-routing'

/**
 * @see https://astraflow.ucloud-global.com
 */
export default class AstraflowLLMProvider extends AISDKRemoteLLMProvider {
  constructor(target: ResolvedLLMTarget) {
    super({
      name: 'Astraflow LLM Provider',
      providerName: 'astraflow',
      apiKeyEnv: 'LEON_ASTRAFLOW_API_KEY',
      model: target.model,
      baseURL: 'https://api-us-ca.umodelverse.ai/v1',
      flavor: 'openai-compatible'
    })
  }
}
