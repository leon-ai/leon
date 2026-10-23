import { getRequiredLLMProviderAccountConfig } from '@/core/llm-manager/llm-provider-account-configs'
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import AISDKRemoteLLMProvider from '@/core/llm-manager/llm-providers/ai-sdk-remote-llm-provider'
import type { ResolvedLLMTarget } from '@/core/llm-manager/llm-routing'
import type {
  CompletionParams,
  LLMReasoningMode,
  PromptOrChatHistory
} from '@/core/llm-manager/types'
import { LLMProviders } from '@/core/llm-manager/types'
import { canDisableLLMModelReasoning, getLLMModelCatalogEntry } from '@/core/llm-manager/llm-model-catalog'

const PROVIDER_CONFIG = getRequiredLLMProviderAccountConfig(LLMProviders.Anthropic)
const DEFAULT_ADAPTIVE_REASONING_EFFORT = 'high'

type ClaudeModelFamily = 'fable' | 'mythos' | 'haiku' | 'opus' | 'sonnet'

interface ClaudeModelVersion {
  family: ClaudeModelFamily
  major: number
  minor: number
}

const CLAUDE_MODEL_ID_PART_SEPARATOR = '-'
const CLAUDE_MODEL_ID_PREFIX = 'claude'
const CLAUDE_MODEL_DATE_PART_LENGTH = 8
const CLAUDE_MODEL_FAMILIES: ClaudeModelFamily[] = [
  'fable',
  'mythos',
  'haiku',
  'opus',
  'sonnet'
]
const CLAUDE_ADAPTIVE_THINKING_MINIMUMS: Partial<
  Record<ClaudeModelFamily, { major: number, minor: number }>
> = {
  // Haiku 5.5 rejects manual thinking budgets; older Haiku models still use them.
  haiku: {
    major: 5,
    minor: 5
  },
  mythos: {
    major: 5,
    minor: 1
  },
  fable: {
    major: 5,
    minor: 0
  },
  opus: {
    major: 4,
    minor: 6
  },
  sonnet: {
    major: 4,
    minor: 6
  }
}
const CLAUDE_SAMPLING_UNSUPPORTED_MINIMUMS: Partial<
  Record<ClaudeModelFamily, { major: number, minor: number }>
> = {
  haiku: {
    major: 5,
    minor: 5
  },
  mythos: {
    major: 5,
    minor: 1
  },
  fable: {
    major: 5,
    minor: 0
  },
  opus: {
    major: 4,
    minor: 7
  }
}

function isClaudeModelDatePart(part: string | undefined): boolean {
  return (
    typeof part === 'string' &&
    part.length === CLAUDE_MODEL_DATE_PART_LENGTH &&
    Number.isInteger(Number(part))
  )
}

function parseClaudeModelVersion(model: string): ClaudeModelVersion | null {
  const parts = model
    .toLowerCase()
    .split(CLAUDE_MODEL_ID_PART_SEPARATOR)

  if (parts[0] !== CLAUDE_MODEL_ID_PREFIX) {
    return null
  }

  const familyIndex = parts.findIndex((part): part is ClaudeModelFamily =>
    CLAUDE_MODEL_FAMILIES.includes(part as ClaudeModelFamily)
  )

  if (familyIndex === -1) {
    return null
  }

  const major = Number(parts[familyIndex + 1])
  const minorPart = parts[familyIndex + 2]
  const minor = isClaudeModelDatePart(minorPart) ? 0 : Number(minorPart ?? 0)

  if (!Number.isInteger(major) || !Number.isInteger(minor)) {
    return null
  }

  return {
    family: parts[familyIndex] as ClaudeModelFamily,
    major,
    minor
  }
}

function isClaudeModelAtLeast(
  model: string,
  minimums: Partial<Record<ClaudeModelFamily, { major: number, minor: number }>>
): boolean {
  const version = parseClaudeModelVersion(model)

  if (!version) {
    return false
  }

  const minimum = minimums[version.family]

  if (!minimum) {
    return false
  }

  return (
    version.major > minimum.major ||
    (version.major === minimum.major && version.minor >= minimum.minor)
  )
}

function shouldOmitTemperature(model: string): boolean {
  return isClaudeModelAtLeast(model, CLAUDE_SAMPLING_UNSUPPORTED_MINIMUMS)
}

function supportsAdaptiveThinking(model: string): boolean {
  return isClaudeModelAtLeast(model, CLAUDE_ADAPTIVE_THINKING_MINIMUMS)
}

function isForcedToolChoice(
  toolChoice: CompletionParams['toolChoice']
): boolean {
  return toolChoice === 'required' || typeof toolChoice !== 'string'
}

function buildManualThinkingOptions(
  completionParams: CompletionParams
): Record<string, unknown> {
  const budget = completionParams.thoughtTokensBudget
  const speed = completionParams.serviceTier === 'priority'
    ? 'fast'
    : completionParams.serviceTier === 'default'
      ? 'standard'
      : undefined

  return {
    anthropic: {
      thinking: {
        type: 'enabled',
        ...(typeof budget === 'number' && Number.isFinite(budget)
          ? { budgetTokens: Math.max(1_024, Math.floor(budget)) }
          : { budgetTokens: 1_024 })
      },
      ...(speed ? { speed } : {}),
      sendReasoning: true
    }
  }
}

function buildAnthropicProviderOptions(
  model: string,
  reasoningMode: LLMReasoningMode | null,
  completionParams: CompletionParams
): Record<string, unknown> {
  const speed = completionParams.serviceTier === 'priority'
    ? 'fast'
    : completionParams.serviceTier === 'default'
      ? 'standard'
      : undefined
  const effectiveReasoningMode = completionParams.disableThinking === true
    || (
      Array.isArray(completionParams.tools) &&
      completionParams.tools.length > 0 &&
      completionParams.toolChoice !== undefined &&
      isForcedToolChoice(completionParams.toolChoice)
    )
    ? 'off'
    : reasoningMode

  if (
    (effectiveReasoningMode === 'off' || effectiveReasoningMode === 'guarded') &&
    !canDisableLLMModelReasoning(LLMProviders.Anthropic, model)
  ) {
    return {
      anthropic: {
        thinking: {
          type: 'adaptive',
          display: 'summarized'
        },
        effort: 'low',
        ...(speed ? { speed } : {}),
        sendReasoning: true
      }
    }
  }

  if (effectiveReasoningMode === 'off' || effectiveReasoningMode === 'guarded') {
    return {
      anthropic: {
        thinking: { type: 'disabled' },
        ...(speed ? { speed } : {}),
        sendReasoning: true
      }
    }
  }

  if (!supportsAdaptiveThinking(model)) {
    return buildManualThinkingOptions(completionParams)
  }

  return {
    anthropic: {
      thinking: {
        type: 'adaptive',
        display: 'summarized'
      },
      effort: completionParams.reasoningEffort === 'none'
        ? DEFAULT_ADAPTIVE_REASONING_EFFORT
        : completionParams.reasoningEffort || DEFAULT_ADAPTIVE_REASONING_EFFORT,
      ...(speed ? { speed } : {}),
      sendReasoning: true
    }
  }
}

export default class AnthropicLLMProvider extends AISDKRemoteLLMProvider {
  /**
   * Changes only the latest turn's effort so cached task history keeps its
   * original request-level thinking configuration.
   */
  protected override buildCallOptions(
    prompt: PromptOrChatHistory,
    completionParams: CompletionParams
  ): LanguageModelV4CallOptions {
    const options = super.buildCallOptions(prompt, completionParams)
    const entry = getLLMModelCatalogEntry(LLMProviders.Anthropic, this.model)
    const baseline = completionParams.reasoningEffortBaseline === 'on'
      ? DEFAULT_ADAPTIVE_REASONING_EFFORT
      : completionParams.reasoningEffortBaseline
    const effort = completionParams.reasoningEffort
    const anthropic = options.providerOptions?.['anthropic']
    const thinking = anthropic?.['thinking']

    if (
      entry?.supportsPerMessageReasoning && baseline && effort &&
      entry.reasoning.includes(baseline) && entry.reasoning.includes(effort) &&
      anthropic && thinking && typeof thinking === 'object' &&
      'type' in thinking && thinking['type'] === 'adaptive'
    ) {
      // Effort-only system messages are serialized by the SDK with its
      // required beta header. Keep this transient update out of task history.
      anthropic['effort'] = baseline
      options.prompt.push({
        role: 'system',
        content: '',
        providerOptions: { anthropic: { effort } }
      })
    }

    return options
  }

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
      flavor: 'anthropic',
      buildProviderOptions: ({ completionParams, reasoningMode }) =>
        buildAnthropicProviderOptions(
          target.model,
          reasoningMode,
          completionParams
        ),
      shouldOmitTemperature: () => shouldOmitTemperature(target.model)
    })
  }
}
