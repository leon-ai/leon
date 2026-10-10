import { describe, expect, it, vi } from 'vitest'

import { parseProfileCredential } from '@/core/profile-auth'
import {
  getActiveProfileName,
  runWithProfileContext
} from '@/core/profile-runtime/profile-context'
import { createProfileServiceProxy } from '@/core/profile-runtime/profile-runtime-manager'
import { isValidProfileName } from '@/core/profile-runtime/profile-paths'
import { CONVERSATION_SESSION_MANAGER, ConversationSessionManager } from '@/core/session-manager'
import { runWithConversationSession } from '@/core/session-manager/session-context'
import SocketServer from '@/core/socket-server'
import type { Socket } from 'socket.io'

const ownerRuntime = vi.hoisted(() => ({
  process: vi.fn(async () => null),
  recordOwnerMessage: vi.fn(async () => undefined),
  interruptVoice: vi.fn()
}))

vi.mock('@/core', () => ({
  NLU: {
    process: ownerRuntime.process,
    recordOwnerMessage: ownerRuntime.recordOwnerMessage
  },
  BRAIN: {
    setIsTalkingWithVoice: ownerRuntime.interruptVoice,
    isMuted: false
  }
}))

describe('profile runtime', () => {
  it.each([
    {
      lifecycle: 'active',
      contract: 'injects follow-ups once into the active turn without clearing typing'
    },
    {
      lifecycle: 'closing',
      contract: 'routes unconsumed follow-ups normally after the active turn closes'
    },
    {
      lifecycle: 'forced',
      contract: 'keeps explicitly routed messages as separate turns'
    }
  ])(
    '$contract',
    async ({ lifecycle }) => {
      await runWithProfileContext({ profileName: 'owner-dispatch' }, async () => {
        const turn = CONVERSATION_SESSION_MANAGER.openAgentTurn('owner-session')
        const server = new SocketServer()
        const emit = vi.fn()
        Object.assign(server, {
          emitToChatClients: emit,
          emitToOtherChatClients: vi.fn()
        })
        const runWithSession = vi.spyOn(ConversationSessionManager.prototype, 'runWithSession')
          .mockImplementation(async (sessionId, callback) => {
            return runWithConversationSession({ sessionId }, callback)
          })
        const utteranceData = {
          sessionId: 'owner-session', value: 'Update the request.',
          messageId: 'owner-update', client: 'webapp',
          ...(lifecycle === 'forced'
            ? { commandContext: { forcedToolName: 'file_system.file' } }
            : { commandContext: {} })
        }
        const dispatch = server as unknown as {
          processOwnerMessage: (socket: Socket, data: typeof utteranceData) => Promise<void>
        }

        try {
          const operation = dispatch.processOwnerMessage(
            { id: 'owner-socket' } as Socket, utteranceData
          )

          if (lifecycle === 'active') {
            const messages = await runWithConversationSession(
              { sessionId: 'owner-session' }, turn.drainOwnerMessages
            )

            expect(messages).toEqual([{ role: 'user', content: 'Update the request.' }])
          } else if (lifecycle === 'closing') {
            turn.close()
          }

          await operation

          if (lifecycle === 'active') {
            expect(ownerRuntime.recordOwnerMessage).toHaveBeenCalledExactlyOnceWith(
              'Update the request.', 'owner-update'
            )
            expect(ownerRuntime.process).not.toHaveBeenCalled()
            expect(runWithSession).not.toHaveBeenCalled()
            expect(emit).not.toHaveBeenCalledWith('is-typing', false, expect.anything())
          } else {
            expect(ownerRuntime.recordOwnerMessage).not.toHaveBeenCalled()
            expect(ownerRuntime.process).toHaveBeenCalledExactlyOnceWith(
              'Update the request.',
              expect.objectContaining({
                ownerMessageId: 'owner-update',
                ...(lifecycle === 'forced' ? { forcedToolName: 'file_system.file' } : {})
              })
            )
            expect(runWithSession).toHaveBeenCalledTimes(1)
          }
        } finally {
          turn.close()
        }
      })
    }
  )

  it('isolates live owner queues by profile and session and prepares messages in the consuming turn', async () => {
    const firstTurn = runWithProfileContext(
      { profileName: 'queue-a' },
      () => CONVERSATION_SESSION_MANAGER.openAgentTurn('shared-id')
    )
    const secondTurn = runWithProfileContext(
      { profileName: 'queue-b' },
      () => CONVERSATION_SESSION_MANAGER.openAgentTurn('shared-id')
    )

    try {
      const firstReceipt = runWithProfileContext(
        { profileName: 'queue-a' },
        () => CONVERSATION_SESSION_MANAGER.queueAgentMessage('shared-id', async () => ({
          role: 'user',
          content: `${getActiveProfileName()}:${CONVERSATION_SESSION_MANAGER.getCurrentSessionId()}`
        }))!
      )
      const secondReceipt = runWithProfileContext(
        { profileName: 'queue-b' },
        () => CONVERSATION_SESSION_MANAGER.queueAgentMessage('shared-id', async () => ({
          role: 'user', content: 'Second profile.'
        }))!
      )
      const inactiveReceipt = runWithProfileContext(
        { profileName: 'queue-a' },
        () => CONVERSATION_SESSION_MANAGER.queueAgentMessage('other-session', async () => ({
          role: 'user', content: 'Separate turn.'
        }))
      )
      const firstMessages = await runWithProfileContext(
        { profileName: 'queue-a' },
        () => runWithConversationSession(
          { sessionId: 'shared-id' }, firstTurn.drainOwnerMessages
        )
      )

      expect(firstMessages).toEqual([{ role: 'user', content: 'queue-a:shared-id' }])
      expect(inactiveReceipt).toBeNull()
      expect(await firstReceipt).toBe(true)
      expect(await secondTurn.drainOwnerMessages()).toEqual([{ role: 'user', content: 'Second profile.' }])
      expect(await secondReceipt).toBe(true)
      expect(await firstTurn.drainOwnerMessages()).toEqual([])
    } finally {
      firstTurn.close()
      secondTurn.close()
    }
  })

  it('rejects invalid queued input without ending the turn and releases pending messages for normal routing', async () => {
    const manager = new ConversationSessionManager()
    const turn = manager.openAgentTurn('active')
    const invalidReceipt = manager.queueAgentMessage('active', async () => {
      throw new Error('Invalid attachment.')
    })!
    const rejection = expect(invalidReceipt).rejects.toThrow('Invalid attachment.')
    const validReceipt = manager.queueAgentMessage('active', async () => ({
      role: 'user', content: 'Valid input.'
    }))!

    expect(await turn.drainOwnerMessages()).toEqual([{ role: 'user', content: 'Valid input.' }])
    await rejection
    expect(await validReceipt).toBe(true)
    expect(manager.isAgentTurnActive('active')).toBe(true)

    let prepared = false
    const pendingReceipt = manager.queueAgentMessage('active', async () => {
      prepared = true

      return { role: 'user', content: 'Next turn.' }
    })!
    turn.close()

    expect(await pendingReceipt).toBe(false)
    expect(prepared).toBe(false)
    expect(manager.isAgentTurnActive('active')).toBe(false)
    expect(manager.queueAgentMessage('active', async () => ({ role: 'user', content: 'Ordinary turn.' })))
      .toBeNull()
  })

  it('parses the public profile credential shape', () => {
    expect(parseProfileCredential('louis:505984bf')).toEqual({
      profileName: 'louis',
      secret: '505984bf',
      value: 'louis:505984bf'
    })
    expect(parseProfileCredential('missing-prefix')).toBeNull()
    expect(parseProfileCredential('../louis:505984bf')).toBeNull()
  })

  it('rejects unsafe profile path segments', () => {
    expect(isValidProfileName('just-me')).toBe(true)
    expect(isValidProfileName('nested/profile')).toBe(false)
    expect(isValidProfileName('nested\\profile')).toBe(false)
    expect(isValidProfileName('profile:token')).toBe(false)
  })

  it('keeps concurrent asynchronous profile contexts isolated', async () => {
    const observedProfiles = await Promise.all(
      ['louis', 'just-me'].map((profileName) =>
        runWithProfileContext({ profileName }, async () => {
          await Promise.resolve()
          return getActiveProfileName()
        })
      )
    )

    expect(observedProfiles).toEqual(['louis', 'just-me'])
  })

  it('lazily creates one service per profile', () => {
    let instanceCount = 0
    const service = createProfileServiceProxy('profile-runtime-test', () => ({
      id: ++instanceCount
    }))
    const firstProfileId = runWithProfileContext(
      { profileName: 'profile-a' },
      () => service.id
    )
    const secondProfileId = runWithProfileContext(
      { profileName: 'profile-b' },
      () => service.id
    )
    const repeatedFirstProfileId = runWithProfileContext(
      { profileName: 'profile-a' },
      () => service.id
    )

    expect(firstProfileId).not.toBe(secondProfileId)
    expect(repeatedFirstProfileId).toBe(firstProfileId)
  })
})
