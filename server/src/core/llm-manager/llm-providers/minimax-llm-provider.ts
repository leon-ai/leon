import AISDKRemoteLLMProvider from '@/core/llm-manager/llm-providers/ai-sdk-remote-llm-provider'
import type { ResolvedLLMTarget } from '@/core/llm-manager/llm-routing'
import type {
  CompletionParams,
  LLMReasoningMode
} from '@/core/llm-manager/types'
import { CONFIG_MANAGER } from '@/config'

const ADAPTIVE_THINKING_MODEL = 'MiniMax-M3'
const DEFAULT_BASE_URL = 'https://api.minimax.io/v1'

type MiniMaxFlavor = 'anthropic' | 'openai-compatible'

interface MiniMaxEndpoint {
  baseURL: string
  flavor: MiniMaxFlavor
}

function resolveMiniMaxEndpoint(): MiniMaxEndpoint {
  const configuredBaseURL =
    CONFIG_MANAGER.getProviderBaseURL('minimax') || DEFAULT_BASE_URL
  const publicBaseURL = configuredBaseURL.replace(/\/+$/, '')

  if (publicBaseURL.endsWith('/anthropic')) {
    return {
      baseURL: `${publicBaseURL}/v1`,
      flavor: 'anthropic'
    }
  }

  return {
    baseURL: publicBaseURL,
    flavor: 'openai-compatible'
  }
}

function buildMiniMaxProviderOptions(
  model: string,
  flavor: MiniMaxFlavor,
  completionParams: CompletionParams,
  reasoningMode: LLMReasoningMode | null
): Record<string, unknown> {
  const disableThinking =
    completionParams.disableThinking === true ||
    reasoningMode === 'off' ||
    reasoningMode === 'guarded'

  const thinking = model === ADAPTIVE_THINKING_MODEL
    ? {
        thinking: {
          type: disableThinking ? 'disabled' : 'adaptive'
        }
      }
    : {}

  if (flavor === 'anthropic') {
    return {
      anthropic: {
        ...thinking,
        sendReasoning: true
      }
    }
  }

  return {
    minimax: {
      reasoning_split: true,
      ...thinking
    }
  }
}

/**
 * @see https://platform.minimax.io/docs/api-reference/api-overview
 */
export default class MiniMaxLLMProvider extends AISDKRemoteLLMProvider {
  constructor(target: ResolvedLLMTarget) {
    const endpoint = resolveMiniMaxEndpoint()

    super({
      name: 'MiniMax LLM Provider',
      providerName: 'minimax',
      apiKeyEnv: 'LEON_MINIMAX_API_KEY',
      model: target.model,
      baseURL: endpoint.baseURL,
      flavor: endpoint.flavor,
      buildProviderOptions: ({ completionParams, reasoningMode }) =>
        buildMiniMaxProviderOptions(
          target.model,
          endpoint.flavor,
          completionParams,
          reasoningMode
        )
    })
  }
}
