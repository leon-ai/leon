import { LLMProviders } from '@/core/llm-manager/types'

export const LLM_MODEL_REASONING_VALUES = [
  'auto',
  'on',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
] as const
export const LLM_MODEL_SPEED_VALUES = ['auto', 'normal', 'fast'] as const

export type LLMModelReasoning = typeof LLM_MODEL_REASONING_VALUES[number]
export type LLMModelSpeed = typeof LLM_MODEL_SPEED_VALUES[number]

export interface LLMModelCatalogEntry {
  provider: LLMProviders
  model: string
  label: string
  recommended?: boolean
  reasoning: readonly LLMModelReasoning[]
  speed: readonly LLMModelSpeed[]
}

const AUTO_REASONING = ['auto'] as const satisfies readonly LLMModelReasoning[]
const TOGGLE_REASONING = [
  'auto',
  'on',
  'none'
] as const satisfies readonly LLMModelReasoning[]
const OPENAI_GPT_56_REASONING = [
  'auto',
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
] as const satisfies readonly LLMModelReasoning[]
const OPENAI_GPT_55_REASONING = [
  'auto',
  'none',
  'low',
  'medium',
  'high',
  'xhigh'
] as const satisfies readonly LLMModelReasoning[]
const OPENAI_GPT_54_REASONING = OPENAI_GPT_55_REASONING
const OPTIONAL_XHIGH_REASONING = [
  'auto',
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
] as const satisfies readonly LLMModelReasoning[]
const OPTIONAL_MAX_REASONING = [
  'auto',
  'none',
  'low',
  'medium',
  'high',
  'max'
] as const satisfies readonly LLMModelReasoning[]
const MANDATORY_XHIGH_REASONING = [
  'auto',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
] as const satisfies readonly LLMModelReasoning[]
const OPENROUTER_GLM_52_REASONING = [
  'auto',
  'none',
  'high',
  'xhigh'
] as const satisfies readonly LLMModelReasoning[]
const ZAI_GLM_52_REASONING = [
  'auto',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
] as const satisfies readonly LLMModelReasoning[]
const OPENROUTER_KIMI_K3_REASONING = [
  'auto',
  'none',
  'low',
  'high',
  'max'
] as const satisfies readonly LLMModelReasoning[]
const MOONSHOT_KIMI_K3_REASONING = [
  'auto',
  'low',
  'high',
  'max'
] as const satisfies readonly LLMModelReasoning[]
const AUTO_SPEED = ['auto'] as const satisfies readonly LLMModelSpeed[]
const ROUTABLE_SPEED = [
  'auto',
  'normal',
  'fast'
] as const satisfies readonly LLMModelSpeed[]

/**
 * Leon's curated model catalog. Runtime discovery is deliberately avoided so
 * setup and command autocomplete remain deterministic and work offline.
 */
export const LLM_MODEL_CATALOG: readonly LLMModelCatalogEntry[] = [
  /**
   * @see https://docs.celeris.ai/models Fast diffusion model for short agentic calls.
   */
  { provider: LLMProviders.Celeris, model: 'celeris-1', label: 'Celeris 1', recommended: true, reasoning: AUTO_REASONING, speed: AUTO_SPEED },

  /**
   * @see https://openrouter.ai/google/gemini-3.5-flash-lite Reasoning is mandatory for this endpoint.
   */
  { provider: LLMProviders.OpenRouter, model: 'google/gemini-3.5-flash-lite', label: 'google/gemini-3.5-flash-lite', reasoning: AUTO_REASONING, speed: ROUTABLE_SPEED },

  /**
   * @see https://openrouter.ai/openai/gpt-5.6-sol Model-specific reasoning support.
   * @see https://openrouter.ai/docs/guides/routing/model-variants/nitro Model-specific fast routing.
   */
  { provider: LLMProviders.OpenRouter, model: 'openai/gpt-5.6-sol', label: 'openai/gpt-5.6-sol', recommended: true, reasoning: OPENAI_GPT_56_REASONING, speed: ROUTABLE_SPEED },
  /**
   * @see https://openrouter.ai/openai/gpt-5.6-terra Model-specific reasoning support.
   * @see https://openrouter.ai/docs/guides/routing/model-variants/nitro Model-specific fast routing.
   */
  { provider: LLMProviders.OpenRouter, model: 'openai/gpt-5.6-terra', label: 'openai/gpt-5.6-terra', reasoning: OPENAI_GPT_56_REASONING, speed: ROUTABLE_SPEED },
  /**
   * @see https://openrouter.ai/openai/gpt-5.6-luna Model-specific reasoning support.
   * @see https://openrouter.ai/docs/guides/routing/model-variants/nitro Model-specific fast routing.
   */
  { provider: LLMProviders.OpenRouter, model: 'openai/gpt-5.6-luna', label: 'openai/gpt-5.6-luna', reasoning: OPENAI_GPT_56_REASONING, speed: ROUTABLE_SPEED },
  /**
   * @see https://openrouter.ai/openai/gpt-5.5 Model-specific reasoning support.
   * @see https://openrouter.ai/docs/guides/routing/model-variants/nitro Model-specific fast routing.
   */
  { provider: LLMProviders.OpenRouter, model: 'openai/gpt-5.5', label: 'openai/gpt-5.5', reasoning: OPENAI_GPT_55_REASONING, speed: ROUTABLE_SPEED },
  /**
   * @see https://openrouter.ai/openai/gpt-5.4 Model-specific reasoning support.
   * @see https://openrouter.ai/docs/guides/routing/model-variants/nitro Model-specific fast routing.
   */
  { provider: LLMProviders.OpenRouter, model: 'openai/gpt-5.4', label: 'openai/gpt-5.4', reasoning: OPENAI_GPT_54_REASONING, speed: ROUTABLE_SPEED },
  /**
   * @see https://openrouter.ai/openai/gpt-5.4-mini Model-specific reasoning support.
   * @see https://openrouter.ai/docs/guides/routing/model-variants/nitro Model-specific fast routing.
   */
  { provider: LLMProviders.OpenRouter, model: 'openai/gpt-5.4-mini', label: 'openai/gpt-5.4-mini', reasoning: OPENAI_GPT_54_REASONING, speed: ROUTABLE_SPEED },
  /**
   * @see https://openrouter.ai/anthropic/claude-fable-5 Model-specific reasoning support.
   * @see https://openrouter.ai/docs/guides/routing/model-variants/nitro Model-specific fast routing.
   */
  { provider: LLMProviders.OpenRouter, model: 'anthropic/claude-fable-5', label: 'anthropic/claude-fable-5', reasoning: MANDATORY_XHIGH_REASONING, speed: ROUTABLE_SPEED },
  /**
   * @see https://openrouter.ai/anthropic/claude-opus-5 Model-specific reasoning support.
   * @see https://openrouter.ai/docs/guides/routing/model-variants/nitro Model-specific fast routing.
   */
  { provider: LLMProviders.OpenRouter, model: 'anthropic/claude-opus-5', label: 'anthropic/claude-opus-5', reasoning: OPTIONAL_XHIGH_REASONING, speed: ROUTABLE_SPEED },
  /**
   * @see https://openrouter.ai/anthropic/claude-opus-4.8 Model-specific reasoning support.
   * @see https://openrouter.ai/docs/guides/routing/model-variants/nitro Model-specific fast routing.
   */
  { provider: LLMProviders.OpenRouter, model: 'anthropic/claude-opus-4.8', label: 'anthropic/claude-opus-4.8', reasoning: OPTIONAL_XHIGH_REASONING, speed: ROUTABLE_SPEED },
  /**
   * @see https://openrouter.ai/anthropic/claude-opus-4.7 Model-specific reasoning support.
   * @see https://openrouter.ai/docs/guides/routing/model-variants/nitro Model-specific fast routing.
   */
  { provider: LLMProviders.OpenRouter, model: 'anthropic/claude-opus-4.7', label: 'anthropic/claude-opus-4.7', reasoning: OPTIONAL_XHIGH_REASONING, speed: ROUTABLE_SPEED },
  /**
   * @see https://openrouter.ai/anthropic/claude-opus-4.6 Model-specific reasoning support.
   * @see https://openrouter.ai/docs/guides/routing/model-variants/nitro Model-specific fast routing.
   */
  { provider: LLMProviders.OpenRouter, model: 'anthropic/claude-opus-4.6', label: 'anthropic/claude-opus-4.6', reasoning: OPTIONAL_MAX_REASONING, speed: ROUTABLE_SPEED },
  /**
   * @see https://openrouter.ai/anthropic/claude-sonnet-4.6 Model-specific reasoning support.
   * @see https://openrouter.ai/docs/guides/routing/model-variants/nitro Model-specific fast routing.
   */
  { provider: LLMProviders.OpenRouter, model: 'anthropic/claude-sonnet-4.6', label: 'anthropic/claude-sonnet-4.6', reasoning: OPTIONAL_MAX_REASONING, speed: ROUTABLE_SPEED },
  /**
   * @see https://openrouter.ai/xiaomi/mimo-v2.5-pro Model-specific reasoning support.
   * @see https://openrouter.ai/docs/guides/routing/model-variants/nitro Model-specific fast routing.
   */
  { provider: LLMProviders.OpenRouter, model: 'xiaomi/mimo-v2.5-pro', label: 'xiaomi/mimo-v2.5-pro', reasoning: TOGGLE_REASONING, speed: ROUTABLE_SPEED },
  /**
   * @see https://openrouter.ai/z-ai/glm-5.2 Model-specific reasoning support.
   * @see https://openrouter.ai/docs/guides/routing/model-variants/nitro Model-specific fast routing.
   */
  { provider: LLMProviders.OpenRouter, model: 'z-ai/glm-5.2', label: 'z-ai/glm-5.2', reasoning: OPENROUTER_GLM_52_REASONING, speed: ROUTABLE_SPEED },
  /**
   * @see https://openrouter.ai/z-ai/glm-5.1 Model-specific reasoning support.
   * @see https://openrouter.ai/docs/guides/routing/model-variants/nitro Model-specific fast routing.
   */
  { provider: LLMProviders.OpenRouter, model: 'z-ai/glm-5.1', label: 'z-ai/glm-5.1', reasoning: TOGGLE_REASONING, speed: ROUTABLE_SPEED },
  /**
   * @see https://openrouter.ai/z-ai/glm-5-turbo Model-specific reasoning support.
   * @see https://openrouter.ai/docs/guides/routing/model-variants/nitro Model-specific fast routing.
   */
  { provider: LLMProviders.OpenRouter, model: 'z-ai/glm-5-turbo', label: 'z-ai/glm-5-turbo', reasoning: TOGGLE_REASONING, speed: ROUTABLE_SPEED },
  /**
   * @see https://openrouter.ai/moonshotai/kimi-k3 Model-specific reasoning support.
   * @see https://openrouter.ai/docs/guides/routing/model-variants/nitro Model-specific fast routing.
   */
  { provider: LLMProviders.OpenRouter, model: 'moonshotai/kimi-k3', label: 'moonshotai/kimi-k3', reasoning: OPENROUTER_KIMI_K3_REASONING, speed: ROUTABLE_SPEED },
  /**
   * @see https://openrouter.ai/moonshotai/kimi-k2.6 Model-specific reasoning support.
   * @see https://openrouter.ai/docs/guides/routing/model-variants/nitro Model-specific fast routing.
   */
  { provider: LLMProviders.OpenRouter, model: 'moonshotai/kimi-k2.6', label: 'moonshotai/kimi-k2.6', reasoning: TOGGLE_REASONING, speed: ROUTABLE_SPEED },
  /**
   * @see https://openrouter.ai/minimax/minimax-m3 Model-specific reasoning support.
   * @see https://openrouter.ai/docs/guides/routing/model-variants/nitro Model-specific fast routing.
   */
  { provider: LLMProviders.OpenRouter, model: 'minimax/minimax-m3', label: 'minimax/minimax-m3', reasoning: TOGGLE_REASONING, speed: ROUTABLE_SPEED },

  /**
   * @see https://developers.openai.com/api/docs/models/gpt-5.6-sol Model-specific reasoning support.
   * @see https://developers.openai.com/api/docs/guides/fast-mode Model-specific fast service tier.
   */
  { provider: LLMProviders.OpenAI, model: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', recommended: true, reasoning: OPENAI_GPT_56_REASONING, speed: ROUTABLE_SPEED },
  /**
   * @see https://developers.openai.com/api/docs/models/gpt-5.6-terra Model-specific reasoning support.
   * @see https://developers.openai.com/api/docs/guides/fast-mode Model-specific fast service tier.
   */
  { provider: LLMProviders.OpenAI, model: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', reasoning: OPENAI_GPT_56_REASONING, speed: ROUTABLE_SPEED },
  /**
   * @see https://developers.openai.com/api/docs/models/gpt-5.6-luna Model-specific reasoning support.
   * @see https://developers.openai.com/api/docs/guides/fast-mode Model-specific fast service tier.
   */
  { provider: LLMProviders.OpenAI, model: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', reasoning: OPENAI_GPT_56_REASONING, speed: ROUTABLE_SPEED },
  /**
   * @see https://developers.openai.com/api/docs/models/gpt-5.5 Model-specific reasoning support.
   * @see https://developers.openai.com/api/docs/guides/fast-mode Model-specific fast service tier.
   */
  { provider: LLMProviders.OpenAI, model: 'gpt-5.5', label: 'GPT-5.5', reasoning: OPENAI_GPT_55_REASONING, speed: ROUTABLE_SPEED },
  /**
   * @see https://developers.openai.com/api/docs/models/gpt-5.4 Model-specific reasoning support.
   * @see https://developers.openai.com/api/docs/guides/fast-mode Model-specific fast service tier.
   */
  { provider: LLMProviders.OpenAI, model: 'gpt-5.4', label: 'GPT-5.4', reasoning: OPENAI_GPT_54_REASONING, speed: ROUTABLE_SPEED },
  /**
   * @see https://developers.openai.com/api/docs/models/gpt-5.4-mini Model-specific reasoning support.
   */
  { provider: LLMProviders.OpenAI, model: 'gpt-5.4-mini', label: 'GPT-5.4 mini', reasoning: OPENAI_GPT_54_REASONING, speed: AUTO_SPEED },
  /**
   * @see https://developers.openai.com/api/docs/models/gpt-5.4-nano Model-specific reasoning support.
   */
  { provider: LLMProviders.OpenAI, model: 'gpt-5.4-nano', label: 'GPT-5.4 nano', reasoning: OPENAI_GPT_54_REASONING, speed: AUTO_SPEED },

  /**
   * @see https://platform.claude.com/docs/en/build-with-claude/effort Model-specific reasoning support.
   * @see https://platform.claude.com/docs/en/build-with-claude/fast-mode Model-specific fast mode.
   */
  { provider: LLMProviders.Anthropic, model: 'claude-opus-5', label: 'Claude Opus 5', recommended: true, reasoning: OPTIONAL_XHIGH_REASONING, speed: ROUTABLE_SPEED },
  /**
   * @see https://platform.claude.com/docs/en/build-with-claude/effort Model-specific reasoning support.
   * @see https://platform.claude.com/docs/en/build-with-claude/fast-mode Model-specific fast mode.
   */
  { provider: LLMProviders.Anthropic, model: 'claude-opus-4-8', label: 'Claude Opus 4.8', reasoning: OPTIONAL_XHIGH_REASONING, speed: ROUTABLE_SPEED },
  /**
   * @see https://platform.claude.com/docs/en/build-with-claude/effort Model-specific reasoning support.
   */
  { provider: LLMProviders.Anthropic, model: 'claude-fable-5', label: 'Claude Fable 5', reasoning: MANDATORY_XHIGH_REASONING, speed: AUTO_SPEED },
  /**
   * @see https://platform.claude.com/docs/en/build-with-claude/effort Model-specific reasoning support.
   */
  { provider: LLMProviders.Anthropic, model: 'claude-opus-4-7', label: 'Claude Opus 4.7', reasoning: OPTIONAL_XHIGH_REASONING, speed: AUTO_SPEED },
  /**
   * @see https://platform.claude.com/docs/en/build-with-claude/effort Model-specific reasoning support.
   */
  { provider: LLMProviders.Anthropic, model: 'claude-opus-4-6', label: 'Claude Opus 4.6', reasoning: OPTIONAL_MAX_REASONING, speed: AUTO_SPEED },
  /**
   * @see https://platform.claude.com/docs/en/build-with-claude/effort Model-specific reasoning support.
   */
  { provider: LLMProviders.Anthropic, model: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', reasoning: OPTIONAL_MAX_REASONING, speed: AUTO_SPEED },
  /**
   * @see https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting Model-specific reasoning support.
   */
  { provider: LLMProviders.Anthropic, model: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', reasoning: TOGGLE_REASONING, speed: AUTO_SPEED },

  /**
   * @see https://docs.z.ai/guides/llm/glm-5.2 Model-specific reasoning support.
   * @see https://docs.z.ai/guides/overview/concept-param#reasoning_effort Model-specific reasoning effort values.
   */
  { provider: LLMProviders.ZAI, model: 'glm-5.2', label: 'GLM-5.2', recommended: true, reasoning: ZAI_GLM_52_REASONING, speed: AUTO_SPEED },
  /**
   * @see https://docs.z.ai/guides/llm/glm-5.1 Model-specific reasoning support.
   */
  { provider: LLMProviders.ZAI, model: 'glm-5.1', label: 'GLM-5.1', reasoning: TOGGLE_REASONING, speed: AUTO_SPEED },
  /**
   * @see https://docs.z.ai/guides/llm/glm-5-turbo Model-specific reasoning support.
   */
  { provider: LLMProviders.ZAI, model: 'glm-5-turbo', label: 'GLM-5-Turbo', reasoning: TOGGLE_REASONING, speed: AUTO_SPEED },
  /**
   * @see https://docs.z.ai/guides/llm/glm-5 Model-specific reasoning support.
   */
  { provider: LLMProviders.ZAI, model: 'glm-5', label: 'GLM-5', reasoning: TOGGLE_REASONING, speed: AUTO_SPEED },

  /**
   * @see https://platform.minimax.io/docs/api-reference/text-openai-api Model-specific reasoning support.
   * @see https://platform.minimax.io/docs/api-reference/text-openai-api Provider speed tier; not exposed by every supported AI SDK flavor.
   */
  { provider: LLMProviders.MiniMax, model: 'MiniMax-M3', label: 'MiniMax-M3', recommended: true, reasoning: TOGGLE_REASONING, speed: AUTO_SPEED },
  /**
   * @see https://platform.minimax.io/docs/api-reference/text-openai-api Model-specific reasoning support.
   * @see https://platform.minimax.io/docs/api-reference/text-openai-api Provider speed tier; not exposed by every supported AI SDK flavor.
   */
  { provider: LLMProviders.MiniMax, model: 'MiniMax-M2.7', label: 'MiniMax-M2.7', reasoning: AUTO_REASONING, speed: AUTO_SPEED },

  /**
   * @see https://platform.kimi.ai/docs/guide/use-reasoning-effort Model-specific reasoning support.
   */
  { provider: LLMProviders.MoonshotAI, model: 'kimi-k3', label: 'Kimi K3', recommended: true, reasoning: MOONSHOT_KIMI_K3_REASONING, speed: AUTO_SPEED },
  /**
   * @see https://platform.kimi.ai/docs/guide/kimi-k2-6-quickstart Model-specific reasoning support.
   */
  { provider: LLMProviders.MoonshotAI, model: 'kimi-k2.6', label: 'Kimi K2.6', reasoning: TOGGLE_REASONING, speed: AUTO_SPEED },
  /**
   * @see https://platform.kimi.ai/docs/guide/kimi-k2-thinking Model-specific reasoning support.
   */
  { provider: LLMProviders.MoonshotAI, model: 'kimi-k2.5', label: 'Kimi K2.5', reasoning: TOGGLE_REASONING, speed: AUTO_SPEED }
]

/** Returns the catalog entry for an exact provider/model pair. */
export function getLLMModelCatalogEntry(
  provider: LLMProviders | null,
  model: string
): LLMModelCatalogEntry | null {
  if (!provider) {
    return null
  }

  return LLM_MODEL_CATALOG.find(
    (entry) => entry.provider === provider && entry.model === model
  ) || null
}

/** Returns setup and autocomplete model suggestions for a provider. */
export function getLLMModelCatalogEntries(
  provider: LLMProviders
): readonly LLMModelCatalogEntry[] {
  return LLM_MODEL_CATALOG.filter((entry) => entry.provider === provider)
}

/** Returns whether the cataloged model accepts an explicit reasoning-off mode. */
export function canDisableLLMModelReasoning(
  provider: LLMProviders,
  model: string
): boolean {
  const entry = getLLMModelCatalogEntry(provider, model)

  return !entry || entry.reasoning.includes('none')
}

/** Returns catalog providers in their curated setup order. */
export function getLLMModelCatalogProviders(): LLMProviders[] {
  return [...new Set(LLM_MODEL_CATALOG.map((entry) => entry.provider))]
}
