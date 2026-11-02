import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import SQLite from 'better-sqlite3'

import type { RealScenarioTurn } from '../../../e2e/run-agent-provider-scenario'
import type { AgentToolTranscriptMessage } from '@/core/llm-manager/types'
import type { MemoryRecord } from '@/core/memory-manager/types'
import { DEFAULT_TEMPORARY_MEMORY_POLICY, getTemporaryContextSize } from '@@/bridges/runtime/nodejs/temporary-memory'

const LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000

/**
 * Give the owner a durable home default without seeding an archived travel answer.
 */
export async function prepareOmittedTemporaryProfile(profilePath: string): Promise<void> {
  await fs.writeFile(path.join(profilePath, 'context', '.owner-profile.json'), JSON.stringify({
    owner_current_city: 'Shenzhen', owner_current_country: 'China',
    homeAndImportantPlaces: ['Lives in Shenzhen, China.']
  }))
}

/**
 * Seed verified temporary owner evidence through the normal validity/write path.
 */
export async function rememberTemporary(content: string, supersedesItemId?: string): Promise<MemoryRecord> {
  const { MEMORY_MANAGER } = await import('@/core')
  return MEMORY_MANAGER.remember({
    scope: 'temporary', kind: 'note', content,
    sourceType: 'explicit_user', sourceRef: 'scenario:owner-statement',
    importance: 0.1, expiresAt: Date.now() + LIFETIME_MS,
    metadata: { evidence: content },
    ...(supersedesItemId ? { supersedesItemId } : {})
  })
}

/**
 * Keep a valid fact stored while enough higher-priority facts exclude it from injection.
 */
export async function omitFromTemporarySnapshot(record: MemoryRecord): Promise<void> {
  const { MEMORY_MANAGER } = await import('@/core')
  for (let index = 0; index < DEFAULT_TEMPORARY_MEMORY_POLICY.maxItems; index += 1) {
    const content = `For this week, project work item ${index + 1} has a confirmed review slot.`
    await MEMORY_MANAGER.remember({
      scope: 'temporary', kind: 'note', content,
      sourceType: 'explicit_user', sourceRef: `scenario:work-item:${index}`,
      importance: 1, expiresAt: Date.now() + LIFETIME_MS,
      metadata: { evidence: content }
    })
  }
  const snapshot = await MEMORY_MANAGER.getTemporaryContext()
  assert.ok(!snapshot.some((entry) => entry.id === record.id))
  assert.ok(getTemporaryContextSize(snapshot) <= DEFAULT_TEMPORARY_MEMORY_POLICY.tokenBudget)
}

/**
 * Verify actual on-demand recall, unchanged validity, and absence from every injected snapshot.
 */
export async function assertOmittedTemporaryRecall(
  profilePath: string,
  turn: RealScenarioTurn,
  record: MemoryRecord,
  retiredIds: string[] = []
): Promise<void> {
  assert.equal(turn.finalIntent, 'answer', turn.output)
  assert.equal(turn.historyBeforeTurn, 0)
  const calls = turn.toolCalls.filter((call) => call.toolId === 'memory' &&
    call.functionName === 'read' &&
    (call.parsedInput?.['options'] as Record<string, unknown> | undefined)?.['scope'] === 'temporary')
  const hits = calls.flatMap((call) => {
    const output = JSON.parse(call.toolOutput || '{}') as {
      data?: { output?: { result?: { data?: { hits?: Array<{ id: string, scope: string, expiresAt: number }> } } } }
    }
    return output.data?.output?.result?.data?.hits || []
  })
  assert.ok(hits.some((hit) => hit.id === record.id && hit.scope === 'temporary'))
  assert.ok(hits.every((hit) => !retiredIds.includes(hit.id) && hit.expiresAt > Date.now()))
  assert.ok(!turn.executionHistory.some((execution) => execution.function === 'structured_knowledge.memory.write'),
    'Reading a circumstance must not renew it.')

  const state = JSON.parse(await fs.readFile(path.join(
    profilePath, 'sessions', turn.sessionId, '.agent-conversation-state.json'
  ), 'utf8')) as { transcript: AgentToolTranscriptMessage[] }
  const updates = state.transcript.flatMap((message) =>
    message.role === 'user' && message.runtimeContext ? [message.runtimeContext] : [])
  assert.ok(updates.some((context) => context['temporary_context_has_more'] === true))
  assert.ok(updates.every((context) => !Array.isArray(context['temporary_context']) ||
    !context['temporary_context'].some((entry: { id: string }) => entry.id === record.id)))

  const db = new SQLite(path.join(profilePath, 'memory', 'index.sqlite'), { readonly: true })
  try {
    const current = db.prepare('SELECT * FROM active_memory_items WHERE id = ?').get(record.id)
    assert.equal(current?.['expires_at'], record.expiresAt)
    assert.equal(current?.['updated_at'], record.updatedAt)
  } finally {
    db.close()
  }
}
