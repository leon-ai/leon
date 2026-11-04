import { createMemoryActivity } from '@/core/memory-manager/memory-activity'
import { FyiKind } from '@/core/fyi/fyi-contract'
import { FYI_VISIONS } from '@/core/fyi/visions'
import { MemoryActivityAction } from '@/core/llm-manager/memory-activity-contract'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ConversationRepository } from '@/core/session-manager/conversation-repository'
import type { ConversationSession } from '@/core/session-manager'
import type { MessageLog } from '@/types'
import { MAXIMUM_ARCHIVE_PAGE_CHARACTERS, type ArchiveMessagePage } from '@@/bridges/runtime/contracts/conversation-archive'
import { searchConversationSessions } from '@/core/session-manager/session-search'
import { TOOL_CONTENT_PREVIEW_CHARACTERS } from '@/core/session-manager/tool-content-contract'

function session(id: string, timestamp = 1): ConversationSession {
  return {
    id,
    title: id,
    isPinned: false,
    isTitleGenerated: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastMessageAt: null,
    messageCount: 0,
    modelTarget: null
  }
}

describe('profile conversation archive', () => {
  let directory = ''
  const repositories = new Set<ConversationRepository>()

  function open(profile = 'owner'): ConversationRepository {
    const repository = new ConversationRepository(path.join(directory, profile, 'sessions'))
    repositories.add(repository)
    return repository
  }

  function close(repository: ConversationRepository): void {
    repository.close()
    repositories.delete(repository)
  }

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-conversation-archive-'))
  })

  afterEach(async () => {
    for (const repository of repositories) {
      repository.close()
    }
    repositories.clear()
    await fs.rm(directory, { recursive: true, force: true })
  })

  it('rotates mindset lines atomically across sessions and connections, surviving reopen without repeats', () => {
    let repository = open()
    repository.saveSession(session('one'))
    repository.saveSession(session('two'))
    const other = open()
    const texts: string[] = []
    for (let index = 0; index < FYI_VISIONS.length * 2; index++) {
      if (index === 7) {
        close(repository)
        repository = open()
      }
      const connection = index % 2 ? repository : other
      const sessionId = index % 2 ? 'one' : 'two'
      const messageId = `answer-${index}`
      connection.upsertMessage(sessionId, { who: 'leon', messageId, message: 'Done.', isAddedToHistory: true })
      const metadata = connection.readSession(sessionId)
      const footer = connection.saveFyi(sessionId, messageId, 'Done.', null)!
      expect(footer.kind).toBe(FyiKind.Vision)
      expect(connection.readSession(sessionId)).toEqual(metadata)
      expect(connection.readMessage(sessionId, messageId)?.fyi).toEqual(footer)
      expect(connection.readMessages(sessionId, { summary: true }).items.at(-1)?.fyi).toEqual(footer)
      expect(connection.saveFyi(sessionId, messageId, 'Done.', null)).toBeNull()
      texts.push(footer.text)
    }
    expect(new Set(texts.slice(0, FYI_VISIONS.length)).size).toBe(FYI_VISIONS.length)
    expect(new Set(texts.slice(FYI_VISIONS.length)).size).toBe(FYI_VISIONS.length)
    expect(texts[FYI_VISIONS.length]).not.toBe(texts[FYI_VISIONS.length - 1])
  })

  it('rejects stale or deleted FYI targets and keeps accepted footers out of model context', () => {
    const repository = open()
    repository.saveSession(session('chat'))
    repository.upsertMessage('chat', { who: 'leon', messageId: 'answer', message: 'Accepted.', isAddedToHistory: true })
    const footer = { kind: FyiKind.Fact, text: 'FYI, a grounded fact.' }
    expect(repository.saveFyi('chat', 'missing', 'Accepted.', footer)).toBeNull()
    expect(repository.saveFyi('chat', 'answer', 'Earlier draft.', footer)).toBeNull()
    expect(repository.saveFyi('chat', 'answer', 'Accepted.', footer)).toEqual(footer)
    expect(repository.readContextMessages('chat', 5)[0]).not.toHaveProperty('fyi')
    expect(open('another').saveFyi('chat', 'answer', 'Accepted.', footer)).toBeNull()
    repository.upsertMessage('chat', { who: 'leon', messageId: 'answer', message: 'Edited.', isAddedToHistory: true })
    expect(repository.readMessage('chat', 'answer')?.fyi).toBeUndefined()
    expect(repository.saveFyi('chat', 'answer', 'Accepted.', footer)).toBeNull()
    repository.deleteSession('chat')
    expect(repository.saveFyi('chat', 'answer', 'Edited.', footer)).toBeNull()
  })

  it('reads bounded invocation previews and complete bodies independently within their session and profile', () => {
    const repository = open()
    repository.saveSession(session('chat'))
    repository.saveSession(session('other'))
    const output = '你🙂'.repeat(TOOL_CONTENT_PREVIEW_CHARACTERS)
    const commandOutput = `start\n${'line\n'.repeat(8_000)}finished`
    repository.upsertMessage('chat', {
      who: 'leon', message: 'Done', messageId: 'answer', isAddedToHistory: true,
      agentResponseTrace: { id: 'trace', planSteps: [], toolCalls: [
        { id: 'one', name: 'test.read', status: 'success', input: { query: 'hello' }, output, commandOutput },
        { id: 'two', name: 'test.edit', status: 'success', input: JSON.stringify({ path: 'hello.ts', changes: [{ oldText: 'a', newText: 'b' }] }),
          output: { result: { success: true, data: { changed: true, diff: '-a\n+b', diffTruncated: false } } } },
        { id: 'three', name: 'test.read', status: 'success', output: {
          result: { success: true, data: { path: 'hello.ts', content: 'const answer = 42\n', contentHash: 'hash' } }
        } },
        { id: 'four', name: 'test.boolean', status: 'success', input: false, output: true }
      ] }
    })
    const preview = repository.readToolContents('chat', 'trace', 'one')!
    expect(Array.from(preview.output.text)).toHaveLength(TOOL_CONTENT_PREVIEW_CHARACTERS)
    expect(preview.output.truncated).toBe(true)
    expect(preview.commandOutput?.text.endsWith('finished')).toBe(true)
    expect(preview.commandOutput?.truncated).toBe(true)
    expect(JSON.parse(preview.input.text)).toEqual({ query: 'hello' })
    expect(preview.hasChanges).toBe(false)
    const complete = repository.readToolContents('chat', 'answer', 'one', true)!
    expect(complete.output.text).toBe(output)
    expect(complete.output.truncated).toBe(false)
    expect(complete.commandOutput?.text).toBe(commandOutput)
    expect(repository.readToolContents('chat', 'trace', 'two')?.hasChanges).toBe(true)
    expect(repository.readToolContents('chat', 'trace', 'two')?.input.language).toBe('json')
    expect(repository.readToolContents('chat', 'trace', 'three')?.displayOutput).toMatchObject({ text: 'const answer = 42\n', language: 'ts', truncated: false })
    expect(repository.readToolContents('chat', 'trace', 'four')).toMatchObject({ input: { text: 'false' }, output: { text: 'true' } })
    expect(repository.readToolContents('chat', 'trace', 'missing')).toBeNull()
    expect(repository.readToolContents('other', 'trace', 'one')).toBeNull()
    expect(open('another-profile').readToolContents('chat', 'trace', 'one')).toBeNull()
  })

  it('pages complete visible source text without gaps, disclosures or cross-session access', async () => {
    const repository = open()
    repository.saveSession(session('report'))
    repository.saveSession(session('other'))
    const text = `Caldera report opening.\n${'Operational notes 你🙂. '.repeat(1_100)}\nFinal decision: retain the offline export.`
    repository.upsertMessage('report', {
      who: 'owner', message: text, messageId: 'source', isAddedToHistory: true
    })
    repository.upsertMessage('report', {
      who: 'leon', message: 'Private reasoning', messageId: 'hidden', isAddedToHistory: false
    })

    const search = await searchConversationSessions({
      sessionsPath: path.join(directory, 'owner', 'sessions'),
      query: 'Final decision', includeCurrentSession: true
    })
    const match = search.hits[0]!.match
    expect(match).toMatchObject({ messageId: 'source', isTruncated: true })
    expect(repository.readMessageText('report', 'source', {
      offset: match.excerptStart, limit: 1_000
    })?.text).toBe(match.message)

    const pages = []
    let offset: number | null = 0
    while (offset !== null) {
      const page: ArchiveMessagePage = repository.readMessageText('report', 'source', { offset, limit: 777 })!
      expect(page).toMatchObject({ sessionId: 'report', messageId: 'source', who: 'owner', offset })
      expect(Array.from(page.text).length).toBeLessThanOrEqual(777)
      expect(page.totalCharacters).toBe(Array.from(text).length)
      pages.push(page.text)
      offset = page.nextOffset
    }
    expect(pages.join('')).toBe(text)
    expect(Array.from(repository.readMessageText('report', 'source', { limit: 1_000_000 })!.text))
      .toHaveLength(MAXIMUM_ARCHIVE_PAGE_CHARACTERS)
    expect(repository.readMessageText('other', 'source')).toBeNull()
    expect(open('another-profile').readMessageText('report', 'source')).toBeNull()
    expect(repository.readMessageText('report', 'hidden')).toBeNull()
    expect(repository.readMessageText('report', 'missing')).toBeNull()
    expect(() => repository.readMessageText('report', 'source', { offset: -1 })).toThrow('offset')
    expect(() => repository.readMessageText('report', 'source', { limit: 0 })).toThrow('limits')
    expect(() => repository.readMessageText('report', 'source', { offset: text.length + 1 })).toThrow('beyond')
  })

  it('reads ordered source fragments across messages with bounded text and stable continuation', () => {
    const repository = open()
    repository.saveSession(session('book'))
    const sources = ['Opening 你🙂.', 'Middle chapter.', 'Closing decision.']
    for (const [index, message] of sources.entries()) {
      repository.upsertMessage('book', {
        who: 'owner', message, messageId: `part-${index}`, isAddedToHistory: true
      })
      repository.upsertMessage('book', {
        who: 'leon', message: 'Acknowledged.', messageId: `reply-${index}`, isAddedToHistory: true
      })
    }
    repository.upsertMessage('book', {
      who: 'leon', message: 'Private reasoning', messageId: 'hidden', isAddedToHistory: false
    })
    const first = repository.readSessionText('book', { limit: 5 })!
    expect(first.messages).toHaveLength(1)
    expect(first.messages[0]?.text).toBe('Openi')
    expect(first.nextCursor).toBeTypeOf('string')
    repository.upsertMessage('book', {
      who: 'owner', message: 'A later revision.', messageId: 'later', isAddedToHistory: true
    })
    const fragments = [...first.messages]
    let cursor = first.nextCursor
    while (cursor !== null) {
      const page = repository.readSessionText('book', { cursor, limit: 5 })!
      expect(page.messages.reduce((sum, message) => sum + Array.from(message.text).length, 0))
        .toBeLessThanOrEqual(5)
      fragments.push(...page.messages)
      cursor = page.nextCursor
    }
    expect(fragments.every((message) => message.who === 'owner')).toBe(true)
    expect(fragments.map((message) => message.text).join('')).toBe(sources.join(''))
    for (const [index, text] of sources.entries()) {
      expect(fragments.filter((message) => message.messageId === `part-${index}`)
        .map((message) => message.text).join('')).toBe(text)
    }
    expect(repository.readSessionText('missing')).toBeNull()
    expect(open('another-profile').readSessionText('book')).toBeNull()
    repository.saveSession(session('other'))
    expect(() => repository.readSessionText('other', { cursor: first.nextCursor! })).toThrow('cursor')
    expect(() => repository.readSessionText('book', { cursor: first.nextCursor!, role: 'both' })).toThrow('cursor')
    expect(() => repository.readSessionText('book', { cursor: 'invalid' })).toThrow('cursor')
    expect(() => repository.readSessionText('book', { limit: 0 })).toThrow('limit')
  })

  it('imports legacy sessions once, preserves their files, and survives reopening', async () => {
    const root = path.join(directory, 'owner', 'sessions')
    await fs.mkdir(path.join(root, 'legacy'), { recursive: true })
    const index = JSON.stringify({ activeSessionId: 'legacy', sessions: [session('legacy')] })
    const history = JSON.stringify([{
      who: 'owner', message: 'Remember the camera', sentAt: 10, isAddedToHistory: true
    }])
    await fs.writeFile(path.join(root, 'index.json'), index)
    await fs.writeFile(path.join(root, 'legacy', 'conversation_log.json'), history)
    const first = open()

    expect(first.readIndex()?.activeSessionId).toBe('legacy')
    expect(first.readAllMessages('legacy')).toHaveLength(1)
    close(first)
    const reopened = open()
    expect(reopened.readAllMessages('legacy')).toHaveLength(1)
    expect(await fs.readFile(path.join(root, 'index.json'), 'utf8')).toBe(index)
    expect(await fs.readFile(path.join(root, 'legacy', 'conversation_log.json'), 'utf8'))
      .toBe(history)
    expect(reopened.listSessions({ query: 'camera' }).items[0]?.id).toBe('legacy')
  })

  it('rolls back incomplete migration and retries without duplicating earlier sessions', async () => {
    const root = path.join(directory, 'owner', 'sessions')
    await fs.mkdir(path.join(root, 'broken'), { recursive: true })
    await fs.writeFile(path.join(root, 'index.json'), JSON.stringify({
      sessions: [session('good'), session('broken')], activeSessionId: 'good'
    }))
    await fs.writeFile(path.join(root, 'broken', 'conversation_log.json'), 'invalid')

    expect(() => open()).toThrow()
    await fs.writeFile(path.join(root, 'broken', 'conversation_log.json'), '[]')
    expect(open().readIndex()?.sessions.map((entry) => entry.id).sort())
      .toEqual(['broken', 'good'])
  })

  it('isolates profiles, retains history beyond model limits, and pages without duplicates', () => {
    const first = open('first')
    const second = open('second')
    first.saveSession(session('same-id'))
    second.saveSession(session('same-id'))

    for (let index = 0; index < 1_050; index += 1) {
      first.upsertMessage('same-id', {
        who: 'owner', message: `Message ${index}`, isAddedToHistory: true
      }, { sentAt: index + 1 })
    }

    expect(first.readAllMessages('same-id')).toHaveLength(1_050)
    expect(first.readRecentMessages('same-id', 256)).toHaveLength(256)
    expect(first.readSession('same-id')?.messageCount).toBe(1_050)
    expect(second.readAllMessages('same-id')).toEqual([])
    const latest = first.readMessages('same-id', { limit: 30 })
    const previous = first.readMessages('same-id', { limit: 30, before: latest.nextCursor! })
    expect(latest.items[0]?.message).toBe('Message 1020')
    expect(previous.items.at(-1)?.message).toBe('Message 1019')
    expect(new Set([...latest.items, ...previous.items].map((record) => record.messageId)).size)
      .toBe(60)
    const newer = first.readMessages('same-id', { limit: 30, after: previous.previousCursor! })
    expect(newer.items.map((record) => record.messageId)).toEqual(latest.items.map((record) => record.messageId))
    expect(newer.previousCursor).toBeNull()
  })

  it('uses indexed session cursors with pinned sessions first and rejects invalid cursors', () => {
    const repository = open()
    repository.saveSession(session('old', 1))
    repository.saveSession(session('new', 2))
    repository.saveSession({ ...session('pinned', 0), isPinned: true })
    const first = repository.listSessions({ limit: 1 })
    const next = repository.listSessions({ limit: 1, cursor: first.nextCursor! })

    expect(first.items[0]?.id).toBe('pinned')
    expect(next.items[0]?.id).toBe('new')
    expect(() => repository.listSessions({ cursor: 'invalid' })).toThrow()
    expect(() => repository.readMessages('new', { before: 'NaN' })).toThrow()
  })

  it('recalls complete visible owner queries in durable sequence order with bounded text pages', () => {
    const repository = open()
    repository.saveSession(session('chat'))
    repository.saveSession(session('other'))
    const write = (id: string, message: string, who: MessageLog['who'] = 'owner', visible = true): void => {
      repository.upsertMessage('chat', {
        messageId: id, message, who, isAddedToHistory: visible
      }, { sentAt: 1 })
    }

    write('first', 'First query\nwith newlines')
    write('answer', 'Answer text', 'leon')
    write('hidden', 'Hidden query', 'owner', false)
    write('empty', '')
    write('second', 'Second query')
    write('third', 'Third query')
    repository.upsertMessage('other', { who: 'owner', message: 'Another session', isAddedToHistory: true })
    const latest = repository.readQueryHistory('chat', { limit: 1 })
    expect(latest.items).toEqual([{ messageId: 'third', message: 'Third query' }])
    const previous = repository.readQueryHistory('chat', { before: latest.nextCursor!, limit: 1 })
    expect(previous.items).toEqual([{ messageId: 'second', message: 'Second query' }])
    const oldest = repository.readQueryHistory('chat', { before: previous.nextCursor! })
    expect(oldest).toEqual({ items: [{ messageId: 'first', message: 'First query\nwith newlines' }], nextCursor: null })
    const bounded = repository.readQueryHistory('chat', { characters: 'Third query'.length })
    expect(bounded.items).toEqual(latest.items)
    expect(repository.readQueryHistory('chat', { before: bounded.nextCursor!, characters: 1 }))
      .toEqual({ items: [], nextCursor: null })
    expect(() => repository.readQueryHistory('chat', { before: 'NaN' })).toThrow()
    expect(() => repository.readQueryHistory('chat', { limit: 101 })).toThrow()
    expect(() => repository.readQueryHistory('chat', { characters: Number.MAX_SAFE_INTEGER + 1 })).toThrow()
    expect(repository.readQueryHistory('chat', { characters: Number.MAX_SAFE_INTEGER }).items).toHaveLength(3)
    close(repository)
    expect(open().readQueryHistory('chat', { limit: 1 }).items).toEqual(latest.items)
    expect(open('isolated').readQueryHistory('chat').items).toEqual([])
  })

  it('keeps completed answers authoritative over delayed trace snapshots and loads details on demand', () => {
    const repository = open()
    repository.saveSession(session('chat'))
    const record: Omit<MessageLog, 'sentAt'> = {
      who: 'leon', message: 'Done', isAddedToHistory: true,
      agentResponseTrace: {
        id: 'trace',
        planSteps: [],
        reasoning: [{ id: 'thought', text: 'Visible reasoning', phase: 'agent', startedAt: 1 }],
        toolCalls: [{ id: 'tool', name: 'test.lookup', status: 'success', output: { large: 'body' } }]
      }
    }
    repository.upsertMessage('chat', record, { sentAt: 20 })
    repository.upsertMessage('chat', {
      ...record, message: '', isAddedToHistory: false
    }, { activity: true, refreshSentAt: true })
    repository.upsertMessage('chat', {
      who: 'leon', message: 'Internal-only log', isAddedToHistory: false
    })

    const summary = repository.readMessages('chat', { summary: true }).items[0]!
    expect(repository.readMessages('chat').items).toHaveLength(1)
    expect(repository.readMessages('chat').previousCursor).toBeNull()
    expect(summary.message).toBe('Done')
    expect(summary.agentResponseTrace?.toolCalls[0]?.output).toBeUndefined()
    expect(summary.agentResponseTrace?.reasoning?.[0]?.text).toBe('')
    expect(repository.readMessage('chat', 'trace')?.agentResponseTrace?.toolCalls[0]?.output)
      .toEqual({ large: 'body' })
    expect(repository.readSession('chat')?.messageCount).toBe(1)
    repository.deleteSession('chat')
    expect(repository.readAllMessages('chat')).toEqual([])
    expect(() => repository.upsertMessage('chat', record)).toThrow()
  })

  it('replays stable session-filtered event cursors after the database is reopened', () => {
    const repository = open()
    const first = repository.appendEvent({ session_id: 'first', type: 'progress' })
    const other = repository.appendEvent({ session_id: 'other', type: 'progress' })
    close(repository)
    const reopened = open()
    const next = reopened.appendEvent({ session_id: 'first', type: 'completed' })

    expect(next.sequence).toBeGreaterThan(other.sequence)
    expect(reopened.readEvents(first.sequence, 'first').items)
      .toEqual([{ session_id: 'first', type: 'completed', sequence: next.sequence }])
  })

  it('includes profile-wide state in session replay without leaking another profile or session', () => {
    const owner = open()
    const other = open('other')
    other.appendEvent({ session_id: '', type: 'mood_changed', mood: 'angry' })
    owner.appendEvent({ session_id: 'unselected', type: 'progress' })
    const mood = owner.appendEvent({ session_id: '', type: 'mood_changed', mood: 'tired' })
    const selected = owner.appendEvent({ session_id: 'selected', type: 'progress' })
    expect(owner.readEvents(0, 'selected').items).toEqual([mood, selected])
  })

  it('recovers accepted commands as interrupted without repeating their owner messages', () => {
    const repository = open()
    repository.saveSession(session('chat'))
    expect(repository.acceptCommand('chat', 'command', 'Inspect the project').created).toBe(true)
    expect(repository.acceptCommand('chat', 'command', 'Inspect the project').created).toBe(false)
    expect(() => repository.acceptCommand('chat', 'command', 'Different request')).toThrow()
    close(repository)
    const recovered = open()
    recovered.recoverInterruptedCommands()
    expect(recovered.getLatestCommand('chat')?.status).toBe('interrupted')
    expect(recovered.acceptCommand('chat', 'command', 'Inspect the project').created).toBe(false)
    expect(recovered.readAllMessages('chat')).toHaveLength(1)
  })

  it('bounds durable replay by payload bytes while preserving its monotonic frontier', () => {
    const repository = open()
    const event = repository.appendEvent({ session_id: 'chat', body: 'x'.repeat(17 * 1_024 * 1_024) })
    expect(repository.readEvents().items).toEqual([])
    expect(repository.getReplayBounds().latest).toBe(event.sequence)
    const next = repository.appendEvent({ session_id: 'chat', body: 'Done' })
    expect(next.sequence).toBeGreaterThan(event.sequence)
  })
  it('upserts late memory details without changing the answer, metrics or session ordering', () => {
    const repository = open()
    repository.saveSession(session('source'))
    repository.upsertMessage('source', {
      messageId: 'answer', who: 'leon', message: 'Verified answer.', isAddedToHistory: true,
      agentResponseTrace: { id: 'trace', planSteps: [], toolCalls: [], metrics: { durationMs: 125 } }
    }, { sentAt: 1_000 })
    const before = repository.readSession('source')
    const activity = createMemoryActivity('outcome', MemoryActivityAction.Saved, [{
      id: 'fact', content: 'Caldera contact is Nora.'
    }], 2_000, 12)
    expect(repository.upsertMemoryActivity('source', 'trace', activity)).toBe(true)
    expect(repository.upsertMemoryActivity('source', 'trace', activity)).toBe(true)
    expect(repository.readMessage('source', 'answer')).toMatchObject({
      message: 'Verified answer.', sentAt: 1_000, isAddedToHistory: true,
      agentResponseTrace: { metrics: { durationMs: 125 }, progressMessages: [activity] }
    })
    expect(repository.readSession('source')).toEqual(before)
    expect(repository.upsertMemoryActivity('source', 'deleted-answer', activity)).toBe(false)
    expect(open('other').upsertMemoryActivity('source', 'answer', activity)).toBe(false)
  })

})
