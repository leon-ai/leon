import AISDKRemoteLLMProvider from '@/core/llm-manager/llm-providers/ai-sdk-remote-llm-provider'
import type { ResolvedLLMTarget } from '@/core/llm-manager/llm-routing'
import type {
  CompletionParams,
  LLMReasoningMode
} from '@/core/llm-manager/types'

const REASONING_EFFORT_MODEL = 'glm-5.2'

function buildZAIProviderOptions(
  model: string,
  completionParams: CompletionParams,
  reasoningMode: LLMReasoningMode | null
): Record<string, unknown> {
  if (!reasoningMode) {
    return {}
  }

  const isThinkingDisabled = completionParams.disableThinking === true ||
    reasoningMode === 'off' || reasoningMode === 'guarded'

  return {
    // The OpenAI-compatible adapter forwards provider-named extension fields.
    zai: {
      thinking: { type: isThinkingDisabled ? 'disabled' : 'enabled' },
      ...(model === REASONING_EFFORT_MODEL &&
        !isThinkingDisabled &&
        completionParams.reasoningEffort
        ? { reasoningEffort: completionParams.reasoningEffort }
        : {})
    }
  }
}

/**
 * @see https://docs.z.ai/api-reference/llm/chat-completion
 */
export default class ZAILLMProvider extends AISDKRemoteLLMProvider {
  constructor(target: ResolvedLLMTarget) {
    super({
      name: 'Z-AI LLM Provider',
      providerName: 'zai',
      apiKeyEnv: 'LEON_ZAI_API_KEY',
      model: target.model,
      baseURL: 'https://api.z.ai/api/paas/v4',
      flavor: 'openai-compatible',
      buildProviderOptions: ({ completionParams, reasoningMode }) =>
        buildZAIProviderOptions(
          target.model,
          completionParams,
          reasoningMode
        )
    })
  }
}
