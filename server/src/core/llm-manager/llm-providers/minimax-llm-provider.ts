import AISDKRemoteLLMProvider from '@/core/llm-manager/llm-providers/ai-sdk-remote-llm-provider'
import type { ResolvedLLMTarget } from '@/core/llm-manager/llm-routing'
import type {
  CompletionParams,
  LLMReasoningMode
} from '@/core/llm-manager/types'

const ADAPTIVE_THINKING_MODEL = 'MiniMax-M3'

function buildMiniMaxProviderOptions(
  model: string,
  completionParams: CompletionParams,
  reasoningMode: LLMReasoningMode | null
): Record<string, unknown> {
  const disableThinking =
    completionParams.disableThinking === true ||
    reasoningMode === 'off' ||
    reasoningMode === 'guarded'

  return {
    minimax: {
      reasoning_split: true,
      ...(model === ADAPTIVE_THINKING_MODEL
        ? {
            thinking: {
              type: disableThinking ? 'disabled' : 'adaptive'
            }
          }
        : {})
    }
  }
}

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
      flavor: 'openai-compatible',
      buildProviderOptions: ({ completionParams, reasoningMode }) =>
        buildMiniMaxProviderOptions(
          target.model,
          completionParams,
          reasoningMode
        )
    })
  }
}
