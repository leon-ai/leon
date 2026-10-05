import { hasProviderConnection } from '../provider-requests'
import { readGenerationSettings } from './media-generation-settings'
import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'
import { runWithConversationSession } from '@/core/session-manager/session-context'
import { CONFIG_STATE } from '@/core/config-states/config-state'
import { CONFIG_MANAGER } from '@/config'
import { LLMProviders } from '@/core/llm-manager/types'
import { MEDIA_PROVIDERS, DEFAULT_GENERATION_OPTIONS } from './media-generation-catalog'
import {
  MediaKind,
  type MediaGenerationInput,
  type ResolvedMediaGenerationInput
} from './media-generation-types'

interface GenerationTarget {
  provider: LLMProviders
  model: string
  options?: Record<string, unknown>
}

function isConfigured(provider: LLMProviders): boolean {
  return provider === LLMProviders.SGLang
    ? Boolean(CONFIG_MANAGER.getProviderGenerationBaseURL(provider))
    : hasProviderConnection(provider)
}

function validateTarget(
  kind: MediaKind,
  target: GenerationTarget
): GenerationTarget {
  if (!MEDIA_PROVIDERS[target.provider]?.kinds.includes(kind)) {
    throw new Error(
      `Provider ${target.provider} does not support ${kind} generation.`
    )
  }

  if (typeof target.model !== 'string' || !target.model.trim()) {
    throw new Error('A generation model is required.')
  }

  if (!isConfigured(target.provider)) {
    throw new Error(
      `Configure credentials or a generation endpoint for ${target.provider}.`
    )
  }

  return target
}

function defaultOptions(
  kind: MediaKind,
  target: GenerationTarget
): Record<string, unknown> {
  // Speech defaults must not leak into another model, such as MiniMax music.
  return target.model === MEDIA_PROVIDERS[target.provider]?.models[kind]?.[0]
    ? DEFAULT_GENERATION_OPTIONS[target.provider]?.[kind] || {}
    : {}
}

/**
 * Carries available alternatives back to the agent without spending on another account.
 */
export class GenerationSelectionRequired extends Error {
  public readonly choices: Array<{ provider: LLMProviders, models: string[] }>

  constructor(kind: MediaKind, reason: string) {
    super(
      `${reason} Ask the owner which generation provider/model to use. Do not switch accounts automatically. ${kind === MediaKind.Document ? 'Local document.create remains available for PDF/DOCX.' : ''}`
    )
    this.choices = Object.entries(MEDIA_PROVIDERS)
      .filter(
        ([provider, entry]) =>
          entry.kinds.includes(kind) && isConfigured(provider as LLMProviders)
      )
      .map(([provider, entry]) => ({
        provider: provider as LLMProviders,
        models: entry.models[kind] || []
      }))
  }
}

/**
 * HTTP tool calls lose the agent's async context, so recover the owning session's
 * model target before consulting profile defaults. No mutable global provider is used.
 */
function inheritedProvider(sessionId?: string): LLMProviders | null {
  if (!sessionId) {
    return CONFIG_STATE.getModelState().getAgentTarget().provider
  }

  const session = CONVERSATION_SESSION_MANAGER.getSession(sessionId)

  if (!session) {
    throw new Error('Conversation session does not exist.')
  }

  return runWithConversationSession(
    { sessionId, modelTarget: session.modelTarget },
    () => CONFIG_STATE.getModelState().getAgentTarget().provider
  )
}

/**
 * Resolves tool preferences or inherits the active chat provider; no account fallback.
 */
export async function resolveMediaGenerationTarget(
  kind: MediaKind,
  sessionId?: string
): Promise<GenerationTarget> {
  const settings = await readGenerationSettings(kind)
  const provider =
    settings.provider === 'inherit'
      ? inheritedProvider(sessionId)
      : settings.provider

  if (!provider || !MEDIA_PROVIDERS[provider]?.kinds.includes(kind)) {
    throw new GenerationSelectionRequired(
      kind,
      `${provider || 'The configured LLM provider'} does not support ${kind} generation.`
    )
  }

  if (!isConfigured(provider)) {
    throw new GenerationSelectionRequired(
      kind,
      `Generation credentials or endpoint are missing for ${provider}.`
    )
  }

  const model =
    settings.model === 'auto'
      ? MEDIA_PROVIDERS[provider]?.models[kind]?.[0]
      : settings.model

  if (!model) {
    throw new GenerationSelectionRequired(
      kind,
      `Choose a ${kind} model for ${provider} in media_generation.${kind} settings.`
    )
  }

  return validateTarget(kind, { provider, model, options: settings.options })
}

/**
 * Shares identical default resolution between tools, HTTP and in-process clients.
 */
export async function resolveMediaGenerationInput(
  input: MediaGenerationInput
): Promise<ResolvedMediaGenerationInput> {
  const explicit = input.provider !== undefined || input.model !== undefined

  if (explicit && (!input.provider || !input.model)) {
    throw new Error(
      'An explicit generation override requires both provider and model.'
    )
  }

  const target = explicit
    ? validateTarget(input.kind, {
        provider: input.provider!,
        model: input.model!
      })
    : await resolveMediaGenerationTarget(input.kind, input.session_id)

  return {
    ...input,
    ...target,
    options: {
      ...defaultOptions(input.kind, target),
      ...target.options,
      ...input.options
    }
  }
}

/**
 * Reports resolved defaults and actionable setup errors without starting generation.
 */
export async function listMediaDefaults(
  sessionId?: string
): Promise<Record<string, unknown>> {
  return Object.fromEntries(
    await Promise.all(
      Object.values(MediaKind).map(async (kind) => {
        try {
          const target = await resolveMediaGenerationTarget(kind, sessionId)

          return [
            kind,
            {
              ...target,
              options: { ...defaultOptions(kind, target), ...target.options }
            }
          ]
        } catch (error) {
          return [
            kind,
            {
              error: error instanceof Error ? error.message : String(error),
              ...(error instanceof GenerationSelectionRequired
                ? { choices: error.choices }
                : {})
            }
          ]
        }
      })
    )
  )
}
