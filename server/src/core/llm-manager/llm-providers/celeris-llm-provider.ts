import AISDKRemoteLLMProvider from '@/core/llm-manager/llm-providers/ai-sdk-remote-llm-provider'
import type { ResolvedLLMTarget } from '@/core/llm-manager/llm-routing'
import type { CompletionParams, LLMReasoningMode } from '@/core/llm-manager/types'
import { CONFIG_MANAGER } from '@/config'

const MAGNUS_MODEL = 'celeris-1-magnus'

function resolveCelerisBaseURL(model: string): string {
  const configuredURL = CONFIG_MANAGER.getProviderBaseURL('celeris')
  const defaultURL = `https://inference.celeris.ai/${encodeURIComponent(model)}/v1`

  if (!configuredURL) {
    return defaultURL
  }

  const url = new URL(configuredURL)
  // Existing profiles contain the celeris-1 URL. Switch the model path on
  // official endpoints (including regional hosts), preserving custom proxies.
  if (
    (url.hostname === 'inference.celeris.ai' ||
      url.hostname.endsWith('.inference.celeris.ai')) &&
    /^\/celeris-1(?:-magnus)?\/v1\/?$/.test(url.pathname)
  ) {
    url.pathname = `/${encodeURIComponent(model)}/v1`
    return url.toString()
  }

  return configuredURL
}

function buildCelerisProviderOptions(
  model: string,
  completionParams: CompletionParams,
  reasoningMode: LLMReasoningMode | null
): Record<string, unknown> {
  if (model !== MAGNUS_MODEL) {
    return {}
  }

  const effort = completionParams.reasoningEffort
  const disabled = completionParams.disableThinking === true ||
    reasoningMode === 'off' || effort === 'none'
  const enabled = !disabled && (
    reasoningMode !== null || effort !== undefined
  )

  return {
    celeris: {
      chat_template_kwargs: {
        enable_thinking: enabled,
        ...(enabled
          ? {
              reasoning_effort: reasoningMode === 'guarded'
                ? 'low'
                : effort && ['low', 'medium', 'xhigh'].includes(effort)
                  ? effort
                  : 'xhigh'
            }
          : {})
      }
    }
  }
}

/**
 * Celeris routes by model in the URL as well as the request body. Magnus
 * accepts reasoning controls inside chat_template_kwargs; celeris-1 keeps
 * its existing provider defaults.
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
      baseURL: resolveCelerisBaseURL(target.model),
      flavor: 'openai-compatible',
      buildProviderOptions: ({ completionParams, reasoningMode }) =>
        buildCelerisProviderOptions(target.model, completionParams, reasoningMode)
    })
  }
}
