import { LLMProviders } from '@/core/llm-manager/types'
import { getRequiredLLMProviderAccountConfig } from '@/core/llm-manager/llm-provider-account-configs'
import AISDKRemoteLLMProvider from '@/core/llm-manager/llm-providers/ai-sdk-remote-llm-provider'
import type { ResolvedLLMTarget } from '@/core/llm-manager/llm-routing'
import type { CompletionParams, LLMReasoningMode } from '@/core/llm-manager/types'

const PROVIDER_CONFIG = getRequiredLLMProviderAccountConfig(LLMProviders.DeepSeek)

/**
 * DeepSeek enables thinking by default; explicit off and guarded calls keep
 * short workflow completions from consuming a reasoning budget. Forced tool
 * selection requires non-thinking mode, including agent recovery requests.
 */
function isThinkingDisabled(
  params: CompletionParams,
  mode: LLMReasoningMode | null = params.reasoningMode || null
): boolean {
  return params.disableThinking === true || params.reasoningEffort === 'none' ||
    mode === 'off' || mode === 'guarded' || params.toolChoice === 'required' ||
    typeof params.toolChoice === 'object'
}

/**
 * Uses the native SDK, retaining Responses for schema-constrained completions.
 * @see https://api-docs.deepseek.com/guides/responses_api/
 */
export default class DeepSeekLLMProvider extends AISDKRemoteLLMProvider {
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
      flavor: 'deepseek',
      supportsToolResultFiles: true,
      shouldOmitTemperature: (params) => !isThinkingDisabled(params),
      buildProviderOptions: ({ completionParams, reasoningMode }) => {
        const disabled = isThinkingDisabled(completionParams, reasoningMode)
        return {
          deepseek: {
            ...(completionParams.data
              ? { reasoningEffort: disabled ? 'none' : completionParams.reasoningEffort || 'high' }
              : {
                  thinking: { type: disabled ? 'disabled' : 'enabled' },
                  ...(!disabled
                    ? { reasoningEffort: completionParams.reasoningEffort || 'high' }
                    : {})
                })
          }
        }
      }
    })
  }
}
