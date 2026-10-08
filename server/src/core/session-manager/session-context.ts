import { AsyncLocalStorage } from 'node:async_hooks'
import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { recordInferenceUsageMetadata } from '@/core/llm-manager/llm-usage/usage-context'

import type {
  InferenceMetadata,
  TurnInference
} from '@/core/llm-manager/inference-metadata'

interface ConversationSessionContext {
  sessionId: string
  modelTarget?: string | null
}

interface StoredConversationSessionContext extends ConversationSessionContext {
  profileName: string
  inferences: InferenceMetadata[]
}

const conversationSessionStorage =
  new AsyncLocalStorage<StoredConversationSessionContext>()

export function getActiveConversationSessionId(): string | null {
  const context = conversationSessionStorage.getStore()

  return context?.profileName === getActiveProfileName()
    ? context.sessionId
    : null
}

export function getActiveConversationSessionModelTarget(): string | null {
  return conversationSessionStorage.getStore()?.modelTarget || null
}

/**
 * Collects distinct dispatched routes in the current asynchronous turn only.
 */
export function recordTurnInference(inference: InferenceMetadata): void {
  recordInferenceUsageMetadata(inference)

  const context = conversationSessionStorage.getStore()

  if (!context || context.profileName !== getActiveProfileName()) {
    return
  }

  const { inferences } = context
  const serialized = JSON.stringify(inference)

  if (!inferences.some((existing) => JSON.stringify(existing) === serialized)) {
    inferences.push({ ...inference })
  }
}

/**
 * Snapshots attribution before deferred writes or post-turn work can change it.
 * Undefined means there is no turn context; null means no inference was dispatched.
 */
export function getActiveTurnInference(): TurnInference | undefined {
  const context = conversationSessionStorage.getStore()

  if (!context || context.profileName !== getActiveProfileName()) {
    return undefined
  }

  const { inferences } = context

  if (inferences.length === 0) {
    return null
  }

  const snapshot = inferences.map((inference) => ({ ...inference }))

  return snapshot.length === 1 ? snapshot[0]! : snapshot
}

/**
 * Isolates attribution per profile/session while sharing nested work in one turn.
 */
export function runWithConversationSession<T>(
  context: ConversationSessionContext,
  callback: () => T
): T {
  const parent = conversationSessionStorage.getStore()
  const profileName = getActiveProfileName()
  const inferences = parent?.sessionId === context.sessionId &&
    parent.profileName === profileName
    ? parent.inferences
    : []

  return conversationSessionStorage.run({ ...context, profileName, inferences }, callback)
}
