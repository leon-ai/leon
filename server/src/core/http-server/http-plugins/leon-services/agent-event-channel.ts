import { EventEmitter } from 'node:events'

import { getActiveProfileName, runWithProfileContext } from '@/core/profile-runtime/profile-context'
import { isValidProfileName } from '@/core/profile-runtime/profile-paths'
import { CONVERSATION_REPOSITORY } from '@/core/session-manager/conversation-repository'

import type {
  HTTPPluginAgentEvent,
  HTTPPluginSubscribeAgentEventsInput
} from '../types'

const MAXIMUM_REPLAY_EVENTS = 500
const REPLAY_PAGE_SIZE = 100
const MAXIMUM_AGENT_EVENT_CHANNELS = 128
const INACTIVE_CHANNEL_TTL_MS = 3_600_000

interface AgentEventChannel {
  emitter: EventEmitter
  lastAccessedAt: number
}

const agentEventChannels = new Map<string, AgentEventChannel>()

function pruneInactiveAgentEventChannels(
  now: number,
  preservedProfileId?: string
): void {
  const inactiveChannels = [...agentEventChannels.entries()]
    .filter(
      ([profileId, channel]) =>
        profileId !== preservedProfileId &&
        channel.emitter.listenerCount('event') === 0
    )
    .sort((left, right) => left[1].lastAccessedAt - right[1].lastAccessedAt)

  for (const [profileId, channel] of inactiveChannels) {
    const hasExpired = now - channel.lastAccessedAt >= INACTIVE_CHANNEL_TTL_MS
    const exceedsLimit = agentEventChannels.size >= MAXIMUM_AGENT_EVENT_CHANNELS
    if (!hasExpired && !exceedsLimit) break

    agentEventChannels.delete(profileId)
  }
}

function getAgentEventChannel(profileId: string): AgentEventChannel {
  const now = Date.now()
  let channel = agentEventChannels.get(profileId)
  if (!channel) {
    pruneInactiveAgentEventChannels(now)
    channel = {
      emitter: new EventEmitter(),
      lastAccessedAt: now
    }
    channel.emitter.setMaxListeners(100)
    agentEventChannels.set(profileId, channel)
  } else {
    channel.lastAccessedAt = now
    pruneInactiveAgentEventChannels(now, profileId)
  }

  return channel
}

/**
 * Publishes a profile-local event with monotonically increasing sequencing.
 */
export function publishAgentEvent(
  profileId: string,
  event: Omit<
    HTTPPluginAgentEvent,
    'sequence' | 'profile_id' | 'created_at'
  >
): HTTPPluginAgentEvent {
  const channel = getAgentEventChannel(profileId)
  const published = runWithProfileContext({ profileName: profileId }, () =>
    CONVERSATION_REPOSITORY.appendEvent<HTTPPluginAgentEvent>({
      ...event,
      profile_id: profileId,
      created_at: Date.now()
    })
  )
  channel.lastAccessedAt = published.created_at
  channel.emitter.emit('event', published)

  return published
}

/**
 * Replays durable events and subscribes without a gap between snapshot and live
 * delivery. Missing retained history is reported instead of silently skipped.
 */
export async function subscribeAgentEvents(
  input: HTTPPluginSubscribeAgentEventsInput,
  listener: (event: HTTPPluginAgentEvent) => void
): Promise<() => void> {
  const profileName = input.profile_id?.trim() || getActiveProfileName()
  if (!isValidProfileName(profileName)) {
    throw new Error(`Invalid Leon profile name "${profileName}".`)
  }
  const channel = getAgentEventChannel(profileName)
  const matches = (event: HTTPPluginAgentEvent): boolean =>
    (!input.session_id || !event.session_id || event.session_id === input.session_id) &&
    event.sequence > (input.after_sequence || 0)

  let replaying = true
  const pending: HTTPPluginAgentEvent[] = []
  const onEvent = (event: HTTPPluginAgentEvent): void => {
    if (matches(event)) {
      if (replaying) {
        pending.push(event)
      } else {
        listener(event)
      }
    }
  }
  channel.emitter.on('event', onEvent)

  try {
    runWithProfileContext({ profileName }, () => {
      const bounds = CONVERSATION_REPOSITORY.getReplayBounds()
      const after = input.after_sequence ?? Math.max(0, bounds.oldest - 1, bounds.latest - MAXIMUM_REPLAY_EVENTS)
      if (!Number.isSafeInteger(after) || after < 0) {
        throw new Error('Invalid event replay cursor.')
      }

      if (after > bounds.latest || after < bounds.oldest - 1) {
        listener({
          sequence: bounds.latest,
          profile_id: profileName,
          session_id: input.session_id ?? '',
          turn_id: null,
          response_id: null,
          created_at: Date.now(),
          type: 'error',
          data: { code: 'replay_snapshot_required' }
        })
        return
      }

      let cursor = after
      while (cursor < bounds.latest) {
        const page = CONVERSATION_REPOSITORY.readEvents<HTTPPluginAgentEvent>(
          cursor, input.session_id, REPLAY_PAGE_SIZE, bounds.latest
        )
        for (const event of page.items) {
          listener(event)
        }
        if (page.nextCursor === null) {
          break
        }
        cursor = Number(page.nextCursor)
      }
    })

    replaying = false
    for (const event of pending) {
      listener(event)
    }
  } catch (error) {
    channel.emitter.off('event', onEvent)
    throw error
  }

  return () => {
    channel.emitter.off('event', onEvent)
    channel.lastAccessedAt = Date.now()
  }
}
