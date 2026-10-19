import { getRequiredLLMProviderAccountConfig } from '@/core/llm-manager/llm-provider-account-configs'
import AISDKRemoteLLMProvider from '@/core/llm-manager/llm-providers/ai-sdk-remote-llm-provider'
import type { ResolvedLLMTarget } from '@/core/llm-manager/llm-routing'
import type {
  CompletionParams,
  LLMReasoningMode
} from '@/core/llm-manager/types'
import { LLMProviders } from '@/core/llm-manager/types'

const PROVIDER_CONFIG = getRequiredLLMProviderAccountConfig(LLMProviders.MiniMax)

const ADAPTIVE_THINKING_MODEL = 'MiniMax-M3'
const MANDATORY_THINKING_MODEL = 'MiniMax-M3.1-Flash'

type MiniMaxFlavor = 'minimax' | 'openai-compatible'

interface MiniMaxEndpoint {
  baseURL: string
  flavor: MiniMaxFlavor
}

function resolveMiniMaxEndpoint(configuredBaseURL: string): MiniMaxEndpoint {
  const publicBaseURL = configuredBaseURL.replace(/\/+$/, '')

  if (
    publicBaseURL.endsWith('/anthropic') ||
    publicBaseURL.endsWith('/anthropic/v1')
  ) {
    return {
      baseURL: publicBaseURL.endsWith('/anthropic')
        ? `${publicBaseURL}/v1`
        : publicBaseURL,
      flavor: 'minimax'
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
    completionParams.reasoningEffort === 'none' ||
    reasoningMode === 'off' ||
    reasoningMode === 'guarded'
  const mandatoryThinking = model === MANDATORY_THINKING_MODEL

  // Mandatory thinking uses its lowest effort for short or reasoning-off duties.
  const effort = mandatoryThinking
    ? disableThinking ? 'low' : completionParams.reasoningEffort
    : undefined

  const thinking = model === ADAPTIVE_THINKING_MODEL || mandatoryThinking
    ? {
        thinking: {
          type: disableThinking && !mandatoryThinking ? 'disabled' : 'adaptive'
        }
      }
    : {}

  if (flavor === 'minimax') {
    return {
      minimax: {
        ...thinking,
        ...(effort ? { effort } : {}),
        sendReasoning: true
      }
    }
  }

  return {
    minimax: {
      reasoning_split: true,
      ...(effort ? { reasoningEffort: effort } : {}),
      ...thinking
    }
  }
}

/**
 * @see https://platform.minimax.io/docs/api-reference/api-overview
 */
export default class MiniMaxLLMProvider extends AISDKRemoteLLMProvider {
  constructor(target: ResolvedLLMTarget) {
    const endpoint = resolveMiniMaxEndpoint(
      AISDKRemoteLLMProvider.resolveBaseURL(PROVIDER_CONFIG, target.accountCredentials)
    )

    super({
      credentials: target.accountCredentials,
      name: `${PROVIDER_CONFIG.label} LLM Provider`,
      providerName: PROVIDER_CONFIG.value,
      apiKeyEnv: PROVIDER_CONFIG.apiKeyEnv,
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
