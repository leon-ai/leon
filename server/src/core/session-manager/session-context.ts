import { AsyncLocalStorage } from 'node:async_hooks'

interface ConversationSessionContext {
  sessionId: string
  modelTarget?: string | null
}

const conversationSessionStorage =
  new AsyncLocalStorage<ConversationSessionContext>()

export function getActiveConversationSessionId(): string | null {
  return conversationSessionStorage.getStore()?.sessionId || null
}

export function getActiveConversationSessionModelTarget(): string | null {
  return conversationSessionStorage.getStore()?.modelTarget || null
}

export function runWithConversationSession<T>(
  context: ConversationSessionContext,
  callback: () => T
): T {
  return conversationSessionStorage.run(context, callback)
}
