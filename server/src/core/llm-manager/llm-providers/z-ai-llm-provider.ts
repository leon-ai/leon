import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'

import { LLMProviders } from '@/core/llm-manager/types'
import { getRequiredLLMProviderAccountConfig } from '@/core/llm-manager/llm-provider-account-configs'
import AISDKRemoteLLMProvider from '@/core/llm-manager/llm-providers/ai-sdk-remote-llm-provider'
import type { ResolvedLLMTarget } from '@/core/llm-manager/llm-routing'
import type {
  CompletionParams,
  LLMReasoningMode,
  PromptOrChatHistory
} from '@/core/llm-manager/types'

const PROVIDER_CONFIG = getRequiredLLMProviderAccountConfig(LLMProviders.ZAI)

// Z.ai requires a separate opt-in on models verified to stream tool arguments.
const TOOL_STREAM_MODELS = new Set([
  'glm-5.3',
  'glm-5.3-flash',
  'glm-5.2',
  'glm-5.1',
  'glm-5-turbo',
  'glm-5'
])
const REASONING_EFFORT_MODEL = 'glm-5.2'
const REQUIRED_TOOL_INSTRUCTION =
  'Continue by calling one of the available tools that advances the authorized task. Do not return a final answer before performing that action.'

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
        // Keep the exact reasoning history reusable across agent tool turns.
        thinking: { type: 'enabled', clearThinking: false },
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
    zai: {
      thinking: {
        type: isThinkingDisabled ? 'disabled' : 'enabled',
        ...(!isThinkingDisabled ? { clearThinking: false } : {})
      },
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
      flavor: 'zai',
      buildProviderOptions: ({ completionParams, reasoningMode }) =>
        buildZAIProviderOptions(
          target.model,
          completionParams,
          reasoningMode
        )
    })
  }

  /**
   * Retains tool-action intent on an API that supports only automatic selection.
   */
  protected override buildCallOptions(
    prompt: PromptOrChatHistory,
    completionParams: CompletionParams
  ): LanguageModelV4CallOptions {
    const options = super.buildCallOptions(prompt, completionParams)
    const toolChoice = options.toolChoice

    if (
      completionParams.shouldStream && options.tools?.length &&
      toolChoice?.type !== 'none' &&
      TOOL_STREAM_MODELS.has(this.modelName)
    ) {
      options.providerOptions = {
        ...options.providerOptions,
        zai: { ...options.providerOptions?.['zai'], toolStream: true }
      }
    }

    if (toolChoice?.type !== 'required' && toolChoice?.type !== 'tool') {
      return options
    }

    if (toolChoice.type === 'tool') {
      options.tools = (options.tools || []).filter(
        (tool) => tool.name === toolChoice.toolName
      )
    }

    if (!options.tools?.length) {
      throw new Error('Z.ai tool-action requests require an available matching tool.')
    }

    // Keep the cached system prefix and reasoning history intact. Core still
    // reviews completion; automatic selection cannot guarantee a tool call.
    options.toolChoice = { type: 'auto' }
    options.prompt.push({
      role: 'user',
      content: [{ type: 'text', text: REQUIRED_TOOL_INSTRUCTION }]
    })

    return options
  }
}
