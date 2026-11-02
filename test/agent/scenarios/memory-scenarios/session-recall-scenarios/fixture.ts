import assert from 'node:assert/strict'

import type { RealScenarioTurn } from '../../../e2e/run-agent-provider-scenario'
import type { ArchiveMessagePage } from '@@/bridges/runtime/contracts/conversation-archive'

interface ArchivedSource {
  sessionId: string
  messageId: string
  text: string
}

/**
 * Preserve a supplied source in the real archive without a memory projection
 * supplying its full contents to the recall turn.
 */
export async function archiveSource(text: string, sentAt = Date.now()): Promise<ArchivedSource> {
  const { CONVERSATION_LOGGER } = await import('@/core')
  const { CONVERSATION_SESSION_MANAGER } = await import('@/core/session-manager')
  const session = CONVERSATION_SESSION_MANAGER.createSession()
  await CONVERSATION_LOGGER.upsert({
    who: 'owner', message: text, isAddedToHistory: true
  }, { sessionId: session.id, sentAt })
  await CONVERSATION_LOGGER.upsert({
    who: 'leon', message: 'I have the document.', isAddedToHistory: true
  }, { sessionId: session.id, sentAt: sentAt + 1 })
  const messages = await CONVERSATION_LOGGER.loadAll({ sessionId: session.id })
  const messageId = messages.find((message) => message.who === 'owner')?.messageId
  assert.ok(messageId)

  return { sessionId: session.id, messageId, text }
}

/**
 * Supply realistic reference detail between the document's decisive sections.
 */
export function operatingNotes(subject: string, first: number, count: number): string {
  return Array.from({ length: count }, (_, index) => {
    const site = first + index
    return `${subject}, site record ${site}: the field team reviewed the staging inventory, compared the locally recorded batches with the export ledger, and retained the operator's annotated screenshots. The discussion covered desk layout, queue visibility, training observations and the timing of the existing handover. This is supporting context rather than an additional decision or contractual obligation.\n`
  }).join('\n')
}

/**
 * A complete answer needs observed, gap-free source coverage beyond discovery snippets.
 */
export function assertArchivedSourceCoverage(turn: RealScenarioTurn, source: ArchivedSource): void {
  assert.equal(turn.finalIntent, 'answer', turn.output)
  assert.equal(turn.historyBeforeTurn, 0)
  assert.ok(turn.executionHistory.some((execution) =>
    execution.function === 'structured_knowledge.sessions.searchSessions'))
  const pages = turn.toolCalls.flatMap((call) => {
    if (call.toolId !== 'sessions' || call.functionName !== 'readMessage' ||
      call.parsedInput?.['sessionId'] !== source.sessionId ||
      call.parsedInput?.['messageId'] !== source.messageId) {
      return []
    }
    const result = JSON.parse(call.toolOutput || '{}') as {
      data?: { output?: { result?: { data?: ArchiveMessagePage } } }
    }
    const page = result.data?.output?.result?.data
    return page ? [page] : []
  }).sort((left, right) => left.offset - right.offset)
  assert.ok(pages.length > 1, 'The source requires more than one bounded page.')

  const characters = Array.from(source.text)
  let coveredUntil = 0
  for (const page of pages) {
    assert.equal(page.totalCharacters, characters.length)
    assert.ok(page.offset <= coveredUntil, `Unread source range before ${page.offset}.`)
    const end = page.offset + Array.from(page.text).length
    assert.equal(page.text, characters.slice(page.offset, end).join(''))
    coveredUntil = Math.max(coveredUntil, end)
  }
  assert.equal(coveredUntil, characters.length, 'A complete answer must cover the source ending.')
  assert.ok(pages.some((page) => page.nextOffset === null))
}
