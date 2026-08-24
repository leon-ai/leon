import { EventEmitter } from 'node:events'

import { getActiveProfileName, runWithProfileContext } from '@/core/profile-runtime/profile-context'
import { ensureActiveProfileRuntime } from '@/core/profile-runtime/initialize-profile-runtime'
import { isValidProfileName } from '@/core/profile-runtime/profile-paths'

import type {
  HTTPPluginAgentEvent,
  HTTPPluginSubscribeAgentEventsInput
} from '../types'

const MAXIMUM_REPLAY_EVENTS = 500
const MAXIMUM_AGENT_EVENT_CHANNELS = 128
const INACTIVE_CHANNEL_TTL_MS = 3_600_000

interface AgentEventChannel {
  events: HTTPPluginAgentEvent[]
  emitter: EventEmitter
  lastAccessedAt: number
}

const agentEventChannels = new Map<string, AgentEventChannel>()
let latestSequence = 0

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
      events: [],
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

/** Publishes a profile-local event with monotonically increasing sequencing. */
export function publishAgentEvent(
  profileId: string,
  event: Omit<
    HTTPPluginAgentEvent,
    'sequence' | 'profile_id' | 'created_at'
  >
): HTTPPluginAgentEvent {
  const channel = getAgentEventChannel(profileId)
  const published: HTTPPluginAgentEvent = {
    ...event,
    sequence: ++latestSequence,
    profile_id: profileId,
    created_at: Date.now()
  }
  channel.lastAccessedAt = published.created_at
  channel.events.push(published)
  if (channel.events.length > MAXIMUM_REPLAY_EVENTS) {
    channel.events.splice(0, channel.events.length - MAXIMUM_REPLAY_EVENTS)
  }
  channel.emitter.emit('event', published)

  return published
}

/** Replays buffered events and then subscribes to live owner-scoped events. */
export async function subscribeAgentEvents(
  input: HTTPPluginSubscribeAgentEventsInput,
  listener: (event: HTTPPluginAgentEvent) => void
): Promise<() => void> {
  const profileName = input.profile_id?.trim() || getActiveProfileName()
  if (!isValidProfileName(profileName)) {
    throw new Error(`Invalid Leon profile name "${profileName}".`)
  }
  await runWithProfileContext({ profileName }, ensureActiveProfileRuntime)
  const channel = getAgentEventChannel(profileName)
  const matches = (event: HTTPPluginAgentEvent): boolean =>
    (!input.session_id || event.session_id === input.session_id) &&
    event.sequence > (input.after_sequence || 0)

  for (const event of channel.events.filter(matches)) listener(event)

  const onEvent = (event: HTTPPluginAgentEvent): void => {
    if (matches(event)) listener(event)
  }
  channel.emitter.on('event', onEvent)

  return () => {
    channel.emitter.off('event', onEvent)
    channel.lastAccessedAt = Date.now()
  }
}
