import { LLMProviders } from '@/core/llm-manager/types'
import { getRequiredLLMProviderAccountConfig } from '@/core/llm-manager/llm-provider-account-configs'
import AISDKRemoteLLMProvider from '@/core/llm-manager/llm-providers/ai-sdk-remote-llm-provider'
import type { ResolvedLLMTarget } from '@/core/llm-manager/llm-routing'
import type {
  CompletionParams,
  LLMReasoningMode
} from '@/core/llm-manager/types'

const PROVIDER_CONFIG = getRequiredLLMProviderAccountConfig(LLMProviders.ZAI)

const REASONING_EFFORT_MODEL = 'glm-5.2'

function buildZAIProviderOptions(
  model: string,
  completionParams: CompletionParams,
  reasoningMode: LLMReasoningMode | null
): Record<string, unknown> {
  if (model === 'glm-5.3' || model === 'glm-5.3-flash') {
    const requestedEffort = completionParams.reasoningEffort
    const lowEffort = completionParams.disableThinking === true ||
      reasoningMode === 'off' || reasoningMode === 'guarded' ||
      requestedEffort === 'none'

    return {
      zai: {
        thinking: { type: 'enabled' },
        ...(lowEffort
          ? { reasoningEffort: 'low' }
          : requestedEffort && ['low', 'high', 'max'].includes(requestedEffort)
            ? { reasoningEffort: requestedEffort }
            : {})
      }
    }
  }

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
      credentials: target.accountCredentials,
      name: `${PROVIDER_CONFIG.label} LLM Provider`,
      providerName: PROVIDER_CONFIG.value,
      apiKeyEnv: PROVIDER_CONFIG.apiKeyEnv,
      model: target.model,
      baseURL: AISDKRemoteLLMProvider.resolveBaseURL(
        PROVIDER_CONFIG,
        target.accountCredentials
      ),
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
