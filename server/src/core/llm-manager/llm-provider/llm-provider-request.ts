import { CONFIG_STATE } from '@/core/config-states/config-state'
import { getLLMModelDefaultReasoning } from '@/core/llm-manager/llm-model-catalog'
import { LOCAL_SERVER_PROVIDERS } from '@/core/llm-manager/llm-provider/llm-provider-constants'
import type {
  PreparedCompletionParams
} from '@/core/llm-manager/llm-provider/llm-provider-types'
import { type ResolvedLLMTarget } from '@/core/llm-manager/llm-routing'
import {
  LLMDuties,
  LLMProviders,
  type CompletionParams
} from '@/core/llm-manager/types'
import { LogHelper } from '@/helpers/log-helper'

const LOW_VERBOSITY_DUTIES = new Set<LLMDuties>([
  LLMDuties.SkillRouter,
  LLMDuties.ActionCalling,
  LLMDuties.SlotFilling
])

const DEFAULT_MAX_TOKENS = 8_192

const DEFAULT_TEMPERATURE = 0

const DEFAULT_REMOTE_PROVIDER_ERROR_RETRIES = 1

const DEFAULT_MAX_EXECUTION_RETRIES = 2

/**
 * Keep short routing duties concise unless the caller overrides verbosity.
 */
function getDefaultTextVerbosityForDuty(
  dutyType: LLMDuties | null
): CompletionParams['textVerbosity'] | undefined {
  return dutyType && LOW_VERBOSITY_DUTIES.has(dutyType)
    ? 'low'
    : undefined
}

/**
 * Applies per-model user overrides without defeating duty safety settings.
 */
function applyConfiguredModelSettings(
  completionParams: CompletionParams,
  target: ResolvedLLMTarget
): void {
  const settings = CONFIG_STATE.getModelSettingsState().getSettings(target)
  const hasDutyReasoningOverride =
    completionParams.disableThinking === true ||
    completionParams.reasoningMode === 'off'

  if (settings.reasoning !== 'auto' && !hasDutyReasoningOverride) {
    completionParams.reasoningMode = settings.reasoning === 'none'
      ? 'off'
      : 'on'

    if (settings.reasoning === 'on') {
      completionParams.reasoningUseDefaultEffort = true
    } else {
      completionParams.reasoningEffort = settings.reasoning
    }

    if (settings.reasoning === 'none') {
      completionParams.disableThinking = true
    }
  }

  // Short guarded/off duties and explicit effort or token budgets retain priority.
  if (
    settings.reasoning === 'auto' &&
    !hasDutyReasoningOverride &&
    completionParams.reasoningMode === 'on' &&
    !completionParams.reasoningEffort &&
    !completionParams.reasoningUseDefaultEffort &&
    completionParams.thoughtTokensBudget === undefined
  ) {
    const { effort } = getLLMModelDefaultReasoning(target.provider, target.model)

    if (effort) {
      completionParams.reasoningEffort = effort
    }
  }

  // AI SDK v4 still calls OpenAI's Fast Mode "priority". OpenRouter maps
  // the same internal hint to throughput routing in its provider adapter.
  if (!completionParams.serviceTier) {
    if (settings.speed === 'fast') {
      completionParams.serviceTier = 'priority'
    } else if (settings.speed === 'normal') {
      completionParams.serviceTier = 'default'
    }
  }
}

/**
 * Choose the existing inference deadline for local and remote providers.
 */
function getDefaultTimeoutForProvider(providerName: LLMProviders): number {
  return LOCAL_SERVER_PROVIDERS.has(providerName) ? 32_000 : 120_000
}

/**
 * Recognize object schemas whose explicit type can safely be supplied.
 */
function isObjectLikeToolSchema(schema: Record<string, unknown>): boolean {
  if (schema['type'] === 'object') {
    return true
  }

  if (
    schema['properties'] &&
    typeof schema['properties'] === 'object' &&
    !Array.isArray(schema['properties'])
  ) {
    return true
  }

  if (Array.isArray(schema['required'])) {
    return true
  }

  const compositeKeywords: Array<'oneOf' | 'anyOf' | 'allOf'> = [
    'oneOf',
    'anyOf',
    'allOf'
  ]

  for (const keyword of compositeKeywords) {
    const variants = schema[keyword]
    if (!Array.isArray(variants) || variants.length === 0) {
      continue
    }

    const allVariantsObjectLike = variants.every((variant) => {
      if (!variant || typeof variant !== 'object' || Array.isArray(variant)) {
        return false
      }

      const variantSchema = variant as Record<string, unknown>
      if (variantSchema['type'] === 'object') {
        return true
      }

      return Boolean(
        variantSchema['properties'] &&
          typeof variantSchema['properties'] === 'object' &&
          !Array.isArray(variantSchema['properties'])
      )
    })

    if (allVariantsObjectLike) {
      return true
    }
  }

  return false
}

/**
 * Supply object types required by providers without changing declared schemas.
 */
function normalizeToolSchemasForCompatibility(
  tools: CompletionParams['tools']
): CompletionParams['tools'] {
  if (!Array.isArray(tools) || tools.length === 0) {
    return tools
  }

  let hasAdjustedSchema = false

  const normalizedTools = tools.map((tool) => {
    if (!tool?.function?.parameters) {
      return tool
    }

    const parameters = tool.function.parameters
    const hasExplicitType = typeof parameters['type'] === 'string'

    if (hasExplicitType || !isObjectLikeToolSchema(parameters)) {
      return tool
    }

    hasAdjustedSchema = true

    return {
      ...tool,
      function: {
        ...tool.function,
        parameters: {
          type: 'object',
          ...parameters
        }
      }
    }
  })

  if (hasAdjustedSchema) {
    LogHelper.title('LLM Provider')
    LogHelper.debug(
      'Normalized tool parameter schema for provider compatibility (added root type="object").'
    )
  }

  return normalizedTools
}

/**
 * Adapt tool-choice hints to the selected provider protocol.
 */
function normalizeToolChoiceForCompatibility(
  providerName: LLMProviders,
  toolChoice: CompletionParams['toolChoice'],
  tools: CompletionParams['tools']
): CompletionParams['toolChoice'] {
  if (toolChoice === undefined) {
    return toolChoice
  }

  if (!Array.isArray(tools) || tools.length === 0) {
    return toolChoice
  }

  // OpenRouter routes across many upstream providers. Forced/named tool_choice
  // values are not consistently supported across routed endpoints and can fail
  // with 404 "No endpoints found...". Omit tool_choice and keep the tool list
  // constrained for maximum routing compatibility.
  if (providerName === LLMProviders.OpenRouter) {
    if (toolChoice === 'required') {
      LogHelper.title('LLM Provider')
      LogHelper.debug(
        'OpenRouter compatibility: omitted tool_choice="required" (tool list remains constrained).'
      )
      return undefined
    }

    if (typeof toolChoice !== 'string') {
      LogHelper.title('LLM Provider')
      LogHelper.debug(
        'OpenRouter compatibility: omitted named tool_choice (tool list remains constrained).'
      )
      return undefined
    }
  }

  // Z.AI currently supports tool_choice="auto". Omit unsupported values
  // (named/required/none) to preserve compatibility.
  if (providerName === LLMProviders.ZAI) {
    if (typeof toolChoice !== 'string') {
      LogHelper.title('LLM Provider')
      LogHelper.debug(
        'Z.AI compatibility: omitted named tool_choice; using provider default.'
      )
      return undefined
    }

    if (toolChoice !== 'auto') {
      LogHelper.title('LLM Provider')
      LogHelper.debug(
        `Z.AI compatibility: omitted unsupported tool_choice="${toolChoice}".`
      )
      return undefined
    }
  }

  if (providerName === LLMProviders.LlamaCPP) {
    if (typeof toolChoice !== 'string') {
      LogHelper.title('LLM Provider')
      LogHelper.debug(
        'llama.cpp compatibility: converted named tool_choice to "required".'
      )
      return 'required'
    }
  }

  return toolChoice
}

/**
 * Copy a request without the tool-choice hint rejected by a provider.
 */
export function withOmittedToolChoice(
  completionParams: CompletionParams
): CompletionParams {
  const nextParams: CompletionParams = {
    ...completionParams
  }

  if ('toolChoice' in nextParams) {
    delete nextParams.toolChoice
  }

  return nextParams
}

/**
 * Identify local requests that cannot combine thinking with forced tool calls.
 */
function shouldDisableThinkingForForcedToolChoice(
  providerName: LLMProviders,
  completionParams: CompletionParams
): boolean {
  if (providerName !== LLMProviders.LlamaCPP) {
    return false
  }

  return (
    Array.isArray(completionParams.tools) &&
    completionParams.tools.length > 0 &&
    completionParams.toolChoice !== undefined &&
    completionParams.toolChoice !== 'auto'
  )
}

/**
 * Apply duty defaults and provider compatibility before dispatch.
 */
export function prepareCompletionRequest(
  completionParams: CompletionParams,
  providerName: LLMProviders,
  target: ResolvedLLMTarget
): asserts completionParams is PreparedCompletionParams {
  completionParams.timeout =
    completionParams.timeout ?? getDefaultTimeoutForProvider(providerName)
  completionParams.maxRetries =
    completionParams.maxRetries ?? DEFAULT_MAX_EXECUTION_RETRIES
  completionParams.data = completionParams.data ?? null
  completionParams.systemPrompt = completionParams.systemPrompt ?? ''
  completionParams.temperature =
    completionParams.temperature ?? DEFAULT_TEMPERATURE
  // Agent output includes reasoning and tool arguments. Let remote adapters
  // apply model defaults instead of imposing a small workflow-sized ceiling.
  if (completionParams.dutyType !== LLMDuties.ReAct ||
    LOCAL_SERVER_PROVIDERS.has(providerName)) {
    completionParams.maxTokens ??= DEFAULT_MAX_TOKENS
  }
  completionParams.textVerbosity =
    completionParams.textVerbosity ??
    getDefaultTextVerbosityForDuty(completionParams.dutyType)
  completionParams.remoteProviderErrorRetries =
    completionParams.remoteProviderErrorRetries ??
    DEFAULT_REMOTE_PROVIDER_ERROR_RETRIES

  applyConfiguredModelSettings(completionParams, target)

  // TODO: support onToken (stream) for Groq provider too
  completionParams.onToken = completionParams.onToken || ((): void => {})
  completionParams.onReasoningToken =
    completionParams.onReasoningToken || ((): void => {})
  completionParams.shouldStream = completionParams.shouldStream ?? false

  const normalizedTools = normalizeToolSchemasForCompatibility(
    completionParams.tools
  )
  if (normalizedTools) {
    completionParams.tools = normalizedTools
  } else if ('tools' in completionParams) {
    delete completionParams.tools
  }

  const normalizedToolChoice = normalizeToolChoiceForCompatibility(
    providerName,
    completionParams.toolChoice,
    completionParams.tools
  )
  if (normalizedToolChoice !== undefined) {
    completionParams.toolChoice = normalizedToolChoice
  } else if ('toolChoice' in completionParams) {
    delete completionParams.toolChoice
  }

  if (
    shouldDisableThinkingForForcedToolChoice(
      providerName,
      completionParams
    ) &&
    completionParams.disableThinking !== true
  ) {
    completionParams.disableThinking = true
    LogHelper.title('LLM Provider')
    LogHelper.debug(
      'llama.cpp compatibility: disabled thinking because tool_choice is forced.'
    )
  }

}
