import { getRequiredLLMProviderAccountConfig } from '@/core/llm-manager/llm-provider-account-configs'
import { LLMProviders } from '@/core/llm-manager/types'
import AISDKRemoteLLMProvider from '@/core/llm-manager/llm-providers/ai-sdk-remote-llm-provider'
import type { ResolvedLLMTarget } from '@/core/llm-manager/llm-routing'
import type { CompletionParams, LLMReasoningMode } from '@/core/llm-manager/types'

const PROVIDER_CONFIG = getRequiredLLMProviderAccountConfig(LLMProviders.Celeris)

const MAGNUS_MODEL = 'celeris-1-magnus'

function resolveCelerisBaseURL(model: string, configuredURL: string): string {
  const defaultURL = new URL(PROVIDER_CONFIG.baseURL)
  const modelPath = `/${encodeURIComponent(model)}/v1`

  const url = new URL(configuredURL)
  // Existing profiles contain the celeris-1 URL. Switch the model path on
  // official endpoints (including regional hosts), preserving custom proxies.
  if (
    (url.hostname === defaultURL.hostname ||
      url.hostname.endsWith(`.${defaultURL.hostname}`)) &&
    /^\/celeris-1(?:-magnus)?\/v1\/?$/.test(url.pathname)
  ) {
    url.pathname = modelPath
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
      credentials: target.accountCredentials,
      name: `${PROVIDER_CONFIG.label} LLM Provider`,
      providerName: PROVIDER_CONFIG.value,
      apiKeyEnv: PROVIDER_CONFIG.apiKeyEnv,
      model: target.model,
      baseURL: resolveCelerisBaseURL(
        target.model,
        AISDKRemoteLLMProvider.resolveBaseURL(PROVIDER_CONFIG, target.accountCredentials)
      ),
      flavor: 'openai-compatible',
      buildProviderOptions: ({ completionParams, reasoningMode }) =>
        buildCelerisProviderOptions(target.model, completionParams, reasoningMode)
    })
  }
}
