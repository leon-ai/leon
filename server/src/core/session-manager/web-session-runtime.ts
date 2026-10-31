import { CONVERSATION_LOGGER } from '@/core'
import { runAgent } from '@/core/http-server/http-plugins/leon-services/agent-service'
import { publishAgentEvent } from '@/core/http-server/http-plugins/leon-services/agent-event-channel'
import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { createProfileServiceProxy } from '@/core/profile-runtime/profile-runtime-manager'
import { LogHelper } from '@/helpers/log-helper'

import { CONVERSATION_SESSION_MANAGER } from './index'
import { CONVERSATION_REPOSITORY } from './conversation-repository'
import type { ConversationCommandStatus, ConversationCommand } from './conversation-repository'

interface ActiveWebTurn {
  controller: AbortController
  completion: Promise<void>
}

/**
 * Owns browser commands independently of connections and route navigation.
 * Execution remains in the existing agent loop and per-session owner-message queue.
 */
export class WebSessionRuntime {
  private readonly active = new Map<string, Set<ActiveWebTurn>>()

  public isRunning(sessionId: string): boolean {
    return this.active.has(sessionId) || CONVERSATION_SESSION_MANAGER.isAgentTurnActive(sessionId)
  }

  /**
   * Acknowledges durable input once; retries with the same ID never repeat work.
   */
  public submit(sessionId: string, id: string, query: string): ConversationCommand {
    const accepted = CONVERSATION_REPOSITORY.acceptCommand(sessionId, id, query)
    if (!accepted.created) {
      return accepted.command
    }

    CONVERSATION_SESSION_MANAGER.updateSessionFromStoredMessages(sessionId)
    CONVERSATION_SESSION_MANAGER.maybeSetFallbackTitle(sessionId, query)
    const profileId = getActiveProfileName()
    publishAgentEvent(profileId, {
      session_id: sessionId, turn_id: id, response_id: null, type: 'owner_message',
      data: { message: CONVERSATION_REPOSITORY.readMessage(sessionId, id) }
    })
    const controller = new AbortController()
    const completion = this.execute(sessionId, id, query, controller)
    const turn = { controller, completion }
    const turns = this.active.get(sessionId) ?? new Set<ActiveWebTurn>()
    turns.add(turn)
    this.active.set(sessionId, turns)
    void completion.finally(() => {
      turns.delete(turn)
      if (turns.size === 0) {
        this.active.delete(sessionId)
      }
      publishAgentEvent(profileId, {
        session_id: sessionId, turn_id: id, response_id: null, type: 'session_changed',
        data: { is_running: this.isRunning(sessionId) }
      })
    }).catch((error: unknown) => {
      LogHelper.error(`Could not finalize browser turn: ${error}`)
    })

    return accepted.command
  }

  private async execute(sessionId: string, id: string, query: string, controller: AbortController): Promise<void> {
    const profileId = getActiveProfileName()
    const emitStatus = (status: ConversationCommandStatus): void => {
      publishAgentEvent(profileId, {
        session_id: sessionId, turn_id: id, response_id: `${id}:leon`,
        type: 'turn_status', data: { status }
      })
    }
    // Yield until the caller has registered this command's cancellation handle.
    await Promise.resolve()
    emitStatus('accepted')
    let status: ConversationCommandStatus = 'completed'
    let consumed = false
    try {
      controller.signal.throwIfAborted()
      const queued = CONVERSATION_SESSION_MANAGER.queueAgentMessage(sessionId, async () => ({
        role: 'user', content: query
      }))
      consumed = queued ? await queued : false
      if (!consumed) {
        controller.signal.throwIfAborted()
        await CONVERSATION_SESSION_MANAGER.runWithSession(sessionId, () =>
          runAgent({ query, session_id: sessionId, request_id: id, signal: controller.signal })
        )
      }
    } catch (error) {
      status = controller.signal.aborted ? 'stopped' : 'error'
      const message = status === 'stopped' ? 'Stopped by you.' : String(error)
      // A failed/interrupted command remains visible after reload, not just in a toast.
      await CONVERSATION_LOGGER.upsert({
        who: 'leon', message, messageId: `${id}:leon`, isAddedToHistory: true
      }, { sessionId })
      publishAgentEvent(profileId, {
        session_id: sessionId, turn_id: id, response_id: `${id}:leon`, type: 'error',
        data: { message }
      })
    } finally {
      CONVERSATION_REPOSITORY.finishCommand(id, status)
      publishAgentEvent(profileId, {
        session_id: sessionId, turn_id: id, response_id: `${id}:leon`,
        type: 'turn_status', data: { status, consumed }
      })
    }
  }

  /**
   * Stops and drains all browser work for one session before deletion can proceed.
   */
  public async stop(sessionId: string): Promise<void> {
    const turns = [...(this.active.get(sessionId) ?? [])]
    for (const turn of turns) {
      turn.controller.abort(new Error('Stopped by the owner.'))
    }
    CONVERSATION_SESSION_MANAGER.cancelAgentTurn(sessionId)
    await Promise.all(turns.map((turn) => turn.completion))
  }
}

export const WEB_SESSION_RUNTIME = createProfileServiceProxy('web-session-runtime', () => new WebSessionRuntime())
