import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ConversationRepository } from '@/core/session-manager/conversation-repository'
import type { ConversationSession } from '@/core/session-manager'
import type { MessageLog } from '@/types'

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
})
