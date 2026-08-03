import AISDKRemoteLLMProvider from '@/core/llm-manager/llm-providers/ai-sdk-remote-llm-provider'
import type { ResolvedLLMTarget } from '@/core/llm-manager/llm-routing'
import { CONFIG_MANAGER } from '@/config'

const DEFAULT_BASE_URL = 'https://inference.celeris.ai/celeris-1/v1'

/**
 * Celeris exposes an OpenAI-compatible Chat Completions API. It does not
 * accept provider-specific reasoning fields, so the empty provider-options
 * builder deliberately prevents Leon's generic compatible adapter from
 * attaching them when a workflow asks to disable reasoning.
 *
 * @see https://docs.celeris.ai/making-requests
 */
export default class CelerisLLMProvider extends AISDKRemoteLLMProvider {
  constructor(target: ResolvedLLMTarget) {
    super({
      name: 'Celeris LLM Provider',
      providerName: 'celeris',
      apiKeyEnv: 'LEON_CELERIS_API_KEY',
      model: target.model,
      baseURL:
        CONFIG_MANAGER.getProviderBaseURL('celeris') || DEFAULT_BASE_URL,
      flavor: 'openai-compatible',
      buildProviderOptions: () => ({})
    })
  }
}
