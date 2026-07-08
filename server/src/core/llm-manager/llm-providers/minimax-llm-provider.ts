import AISDKRemoteLLMProvider from '@/core/llm-manager/llm-providers/ai-sdk-remote-llm-provider'
import type { ResolvedLLMTarget } from '@/core/llm-manager/llm-routing'

/**
 * @see https://platform.minimax.io/docs/api-reference/api-overview
 */
export default class MiniMaxLLMProvider extends AISDKRemoteLLMProvider {
  constructor(target: ResolvedLLMTarget) {
    super({
      name: 'MiniMax LLM Provider',
      providerName: 'minimax',
      apiKeyEnv: 'LEON_MINIMAX_API_KEY',
      model: target.model,
      baseURL: 'https://api.minimax.io/v1',
      flavor: 'openai-compatible'
    })
  }
}
