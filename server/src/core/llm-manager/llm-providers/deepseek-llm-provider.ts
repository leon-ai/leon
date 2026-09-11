import AISDKRemoteLLMProvider from '@/core/llm-manager/llm-providers/ai-sdk-remote-llm-provider'
import type { ResolvedLLMTarget } from '@/core/llm-manager/llm-routing'
import type { CompletionParams, LLMReasoningMode } from '@/core/llm-manager/types'

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
 * Uses the existing compatible adapter for streaming, tool calls, and JSON.
 * @see https://api-docs.deepseek.com/guides/thinking_mode/
 */
export default class DeepSeekLLMProvider extends AISDKRemoteLLMProvider {
  constructor(target: ResolvedLLMTarget) {
    super({
      name: 'DeepSeek LLM Provider',
      providerName: 'deepseek',
      apiKeyEnv: 'LEON_DEEPSEEK_API_KEY',
      model: target.model,
      baseURL: 'https://api.deepseek.com/v1',
      flavor: 'openai-compatible',
      shouldOmitTemperature: (params) => !isThinkingDisabled(params),
      buildProviderOptions: ({ completionParams, reasoningMode }) => {
        const disabled = isThinkingDisabled(completionParams, reasoningMode)
        return {
          deepseek: {
            thinking: { type: disabled ? 'disabled' : 'enabled' },
            ...(!disabled && completionParams.reasoningEffort
              ? { reasoningEffort: completionParams.reasoningEffort }
              : {})
          }
        }
      },
      transformRequestBody: (body) => ({
        ...body,
        // Runtime checkpoints and history from non-thinking calls have no
        // reasoning. DeepSeek still requires the field on assistant messages.
        messages: (body['messages'] as Array<Record<string, unknown>>).map(
          (message) => message['role'] === 'assistant'
            ? { ...message, reasoning_content: message['reasoning_content'] ?? '' }
            : message
        )
      })
    })
  }
}
