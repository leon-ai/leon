import assert from 'node:assert/strict'

import type { RealScenarioTurn } from '../../../e2e/run-agent-provider-scenario'
import type { ArchiveMessagePage, ArchiveSessionPage } from '@@/bridges/runtime/contracts/conversation-archive'

interface ArchivedSource {
  sessionId: string
  messageId: string
  messages: Array<{ messageId: string, text: string }>
}

/**
 * Preserve a supplied source in the real archive without a memory projection
 * supplying its full contents to the recall turn.
 */
export async function archiveSource(input: string | string[], sentAt = Date.now()): Promise<ArchivedSource> {
  const { CONVERSATION_LOGGER } = await import('@/core')
  const { CONVERSATION_SESSION_MANAGER } = await import('@/core/session-manager')
  const session = CONVERSATION_SESSION_MANAGER.createSession()
  const parts = typeof input === 'string' ? [input] : input
  const messages: ArchivedSource['messages'] = []
  for (const [index, text] of parts.entries()) {
    await CONVERSATION_LOGGER.upsert({
      who: 'owner', message: text, isAddedToHistory: true
    }, { sessionId: session.id, sentAt: sentAt + index * 2 })
    await CONVERSATION_LOGGER.upsert({
      who: 'leon', message: 'I have the document.', isAddedToHistory: true
    }, { sessionId: session.id, sentAt: sentAt + index * 2 + 1 })
    const archived = await CONVERSATION_LOGGER.loadAll({ sessionId: session.id })
    const messageId = archived.filter((message) => message.who === 'owner').at(-1)?.messageId
    assert.ok(messageId)
    messages.push({ messageId, text })
  }
  const messageId = messages[0]?.messageId
  assert.ok(messageId)

  return { sessionId: session.id, messageId, messages }
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
    execution.function === 'structured_knowledge.sessions.searchSessions' ||
    execution.function === 'structured_knowledge.sessions.listSessions'))
  const pages = turn.toolCalls.flatMap((call) => {
    if (call.toolId !== 'sessions' ||
      call.parsedInput?.['sessionId'] !== source.sessionId) {
      return []
    }
    const result = JSON.parse(call.toolOutput || '{}') as {
      data?: { output?: { result?: { data?: ArchiveMessagePage | ArchiveSessionPage } } }
    }
    const data = result.data?.output?.result?.data
    if (call.functionName === 'readSession' && data && 'messages' in data) {
      return data.messages
    }
    if (call.functionName === 'readMessage' && data && 'messageId' in data) {
      return [data]
    }
    return []
  })
  assert.ok(pages.length > 1, 'The source requires more than one bounded page.')

  for (const message of source.messages) {
    const characters = Array.from(message.text)
    const fragments = pages.filter((page) => page.messageId === message.messageId)
      .sort((left, right) => left.offset - right.offset)
    let coveredUntil = 0
    for (const page of fragments) {
      assert.equal(page.totalCharacters, characters.length)
      assert.ok(page.offset <= coveredUntil, `Unread source range before ${page.offset}.`)
      const end = page.offset + Array.from(page.text).length
      assert.equal(page.text, characters.slice(page.offset, end).join(''))
      coveredUntil = Math.max(coveredUntil, end)
    }
    assert.equal(coveredUntil, characters.length, 'A complete answer must cover every source message.')
    assert.ok(fragments.some((page) => page.nextOffset === null))
  }
}
