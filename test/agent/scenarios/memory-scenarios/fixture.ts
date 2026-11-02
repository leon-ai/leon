import assert from 'node:assert/strict'
import path from 'node:path'

import SQLite from 'better-sqlite3'

import type { RealScenarioTurn } from '../../e2e/run-agent-provider-scenario'

/**
 * Seed separate archived conversations through the real memory ingestion path.
 */
export async function seedMemoryConversations(messages: string[]): Promise<void> {
  const { MEMORY_MANAGER, CONVERSATION_LOGGER } = await import('@/core')
  const { CONVERSATION_SESSION_MANAGER } = await import('@/core/session-manager')
  const { runWithConversationSession } = await import('@/core/session-manager/session-context')

  for (const [index, message] of messages.entries()) {
    const session = CONVERSATION_SESSION_MANAGER.createSession()
    await runWithConversationSession({ sessionId: session.id }, async () => {
      await CONVERSATION_LOGGER.push({ who: 'owner', message, isAddedToHistory: true })
      await CONVERSATION_LOGGER.push({ who: 'leon', message: 'Noted.', isAddedToHistory: true })
      await MEMORY_MANAGER.observeTurn({
        userMessage: message, assistantMessage: 'Noted.',
        sentAt: Date.now() + index, route: 'react'
      })
    })
  }
}

/**
 * Inspect authoritative durable state independently of the model's final answer.
 */
export async function persistentScenarioRecords(): Promise<Array<Record<string, unknown>>> {
  const { getProfilePaths } = await import('@/core/profile-runtime/profile-paths')
  const db = new SQLite(path.join(getProfilePaths().memory, 'index.sqlite'), { readonly: true })
  try {
    return db.prepare('SELECT * FROM active_memory_items WHERE scope = \'persistent\'').all()
  } finally {
    db.close()
  }
}

/**
 * Recall must use stored evidence from a fresh conversation.
 */
export function assertMemoryRecall(turn: RealScenarioTurn): void {
  assert.equal(turn.finalIntent, 'answer', turn.output)
  assert.equal(turn.historyBeforeTurn, 0)
  assert.ok(turn.executionHistory.some((execution) => execution.function === 'structured_knowledge.memory.read'))
}
