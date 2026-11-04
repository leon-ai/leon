import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'

import { queryClient } from '@/query-client'
import type { ConversationEvent } from './conversation'

const STORAGE_PREFIX = 'leon.web-app.session-read-state.'
const MAXIMUM_UNREAD_SESSIONS = 512
const EMPTY_STATE: SessionReadState = { cursor: 0, unread: {} }

interface SessionReadState {
  cursor: number
  unread: Record<string, number>
}

function readStateKey(profile: string): readonly string[] {
  return ['session-read-state', profile]
}

function readStoredState(profile: string): SessionReadState {
  try {
    const value = JSON.parse(window.localStorage.getItem(`${STORAGE_PREFIX}${profile}`) ?? 'null') as SessionReadState | null
    if (value && Number.isSafeInteger(value.cursor) && value.cursor >= 0 &&
      value.unread && typeof value.unread === 'object' && !Array.isArray(value.unread)) {
      const entries = Object.entries(value.unread)
        .filter(([id, sequence]) => id.length > 0 && id.length <= 128 &&
          Number.isSafeInteger(sequence) && sequence > 0 && sequence <= value.cursor)
        .sort((left, right) => right[1] - left[1])
        .slice(0, MAXIMUM_UNREAD_SESSIONS)

      return { cursor: value.cursor, unread: Object.fromEntries(entries) }
    }
  } catch {
    // Invalid or blocked browser storage must not prevent session navigation.
  }

  return EMPTY_STATE
}

function getReadState(profile: string): SessionReadState {
  return queryClient.getQueryData<SessionReadState>(readStateKey(profile)) ?? readStoredState(profile)
}

function saveReadState(profile: string, state: SessionReadState): void {
  queryClient.setQueryData(readStateKey(profile), state)
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${profile}`, JSON.stringify(state))
  } catch {
    // The live cache remains usable when persistence is unavailable.
  }
}

/**
 * Shares bounded, profile-scoped unread markers without adding network requests.
 */
export function useSessionReadState(profile: string): SessionReadState {
  return useQuery({
    queryKey: readStateKey(profile),
    queryFn: () => readStoredState(profile),
    initialData: () => profile ? readStoredState(profile) : EMPTY_STATE,
    enabled: false,
    staleTime: Infinity
  }).data
}

/**
 * Opening or deleting a session acknowledges its previously received completions.
 */
export function markSessionRead(profile: string, sessionId: string): void {
  if (!profile) {
    return
  }
  const previous = getReadState(profile)
  if (!Object.hasOwn(previous.unread, sessionId)) {
    return
  }
  const unread = { ...previous.unread }
  delete unread[sessionId]
  saveReadState(profile, { ...previous, unread })
}

/**
 * Records only successful owner-turn completions. A durable sequence frontier
 * prevents replay from restoring a dot that the owner already cleared.
 */
export function recordSessionCompletion(profile: string, viewedSessionId: string | undefined, event: ConversationEvent): void {
  if (!profile || event.type !== 'turn_status' || event.data['status'] !== 'completed' ||
    event.data['consumed'] === true || !event.session_id || !Number.isSafeInteger(event.sequence) || event.sequence <= 0) {
    return
  }
  if (event.session_id === viewedSessionId) {
    markSessionRead(profile, event.session_id)
  }
  const previous = getReadState(profile)
  if (event.sequence <= previous.cursor) {
    return
  }
  const unread = { ...previous.unread }
  if (event.session_id !== viewedSessionId) {
    unread[event.session_id] = event.sequence
  }
  const retained = Object.entries(unread).sort((left, right) => right[1] - left[1])
    .slice(0, MAXIMUM_UNREAD_SESSIONS)

  saveReadState(profile, { cursor: event.sequence, unread: Object.fromEntries(retained) })
}

/**
 * Owns read acknowledgement and cross-tab storage synchronization at layout lifetime.
 */
export function useSessionReadTracking(profile: string, sessionId: string | undefined): void {
  useEffect(() => {
    if (!profile) {
      return
    }
    if (sessionId) {
      markSessionRead(profile, sessionId)
    }
    function syncStorage(event: StorageEvent): void {
      if (event.storageArea !== window.localStorage || event.key !== `${STORAGE_PREFIX}${profile}`) {
        return
      }
      const stored = readStoredState(profile)
      if (stored.cursor >= getReadState(profile).cursor) {
        queryClient.setQueryData(readStateKey(profile), stored)
        if (sessionId) {
          markSessionRead(profile, sessionId)
        }
      }
    }

    window.addEventListener('storage', syncStorage)
    return (): void => window.removeEventListener('storage', syncStorage)
  }, [profile, sessionId])
}
