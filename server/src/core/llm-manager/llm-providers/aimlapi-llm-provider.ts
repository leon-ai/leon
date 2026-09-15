import AISDKRemoteLLMProvider from '@/core/llm-manager/llm-providers/ai-sdk-remote-llm-provider'
import type { ResolvedLLMTarget } from '@/core/llm-manager/llm-routing'
import { CONFIG_MANAGER } from '@/config'

const DEFAULT_BASE_URL = 'https://api.aimlapi.com/v1'
const OFFICIAL_API_HOSTNAME = 'api.aimlapi.com'

/**
 * Attribution sent with AI/ML API requests. `HTTP-Referer` and `X-Title`
 * follow the OpenRouter convention and identify Leon, the calling project,
 * never the gateway.
 */
const AIMLAPI_ATTRIBUTION_HEADERS: Readonly<Record<string, string>> =
  Object.freeze({
    'HTTP-Referer': 'https://github.com/leon-ai/leon',
    'X-Title': 'Leon',
    'X-AIMLAPI-Source': 'agent/leon',
    'X-AIMLAPI-Partner-ID': 'part_lcAMsJBHJpF6eW4JFtT3pJfW'
  })

function resolveBaseURL(): string {
  return CONFIG_MANAGER.getProviderBaseURL('aimlapi') || DEFAULT_BASE_URL
}

/**
 * The Base URL is user-configurable, so attribution is scoped to the official
 * host. A self-hosted gateway or a third-party proxy fronting the same schema
 * must not receive Leon's AI/ML API attribution, and a new object is returned
 * on every call so the shared constant can never be mutated.
 */
export function buildAIMLAPIHeaders(baseURL: string): Record<string, string> {
  let hostname: string

  try {
    hostname = new URL(baseURL).hostname
  } catch {
    return {}
  }

  if (hostname !== OFFICIAL_API_HOSTNAME) {
    return {}
  }

  return { ...AIMLAPI_ATTRIBUTION_HEADERS }
}

/**
 * AI/ML API is an aggregator exposing many upstream vendors behind a single
 * OpenAI-compatible Chat Completions schema.
 *
 * Its validator rejects a `null` value for optional request fields
 * (`temperature`, `top_p`, `seed`, `reasoning_effort`, `tools`, `tool_choice`,
 * `response_format`, `max_tokens`, … all answer HTTP 400), where the upstream
 * OpenAI API accepts them. Unset parameters must therefore be omitted from the
 * request body rather than sent as `null`, which is what the base class does
 * and what `test/agent/unit/aimlapi-llm-provider.spec.ts` guards.
 *
 * Vendor-specific reasoning extension fields are not forwarded either: the
 * field that controls reasoning differs per upstream vendor, so the empty
 * provider-options builder stops Leon's generic compatible adapter from
 * attaching one that this gateway would reject.
 *
 * @see https://docs.aimlapi.com/api-references/text-models-llm
 */
export default class AIMLAPILLMProvider extends AISDKRemoteLLMProvider {
  constructor(target: ResolvedLLMTarget) {
    const baseURL = resolveBaseURL()

    super({
      name: 'AI/ML API LLM Provider',
      providerName: 'aimlapi',
      apiKeyEnv: 'LEON_AIMLAPI_API_KEY',
      model: target.model,
      baseURL,
      flavor: 'openai-compatible',
      headers: () => buildAIMLAPIHeaders(baseURL),
      buildProviderOptions: () => ({})
    })
  }
}
