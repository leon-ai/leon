import { useEffect, useMemo, useRef } from 'react'
import { infiniteQueryOptions, useInfiniteQuery, useMutation, type InfiniteData,
  type UseInfiniteQueryOptions, type UseInfiniteQueryResult, type UseMutationResult } from '@tanstack/react-query'

import { queryClient } from '@/query-client'
import { useToast } from '@/components/toast'
import { requestAPI } from './api'
import type { ConversationCommand, ConversationNotification, ConversationPage, ConversationRecord } from './conversation'
import { applyConversationEvent } from './conversation-events'
import { toFeedEntry } from './conversation-feed'
import { PROFILE_AUTH_QUERY_KEY, useProfile } from './profile'
import { ConnectionError, requestErrors } from './request-errors'
import { sessionsQueryKey, SESSION_PAGE_SIZE, SessionStatus, type SessionsPage } from './sessions'
import type { FeedEntry } from './feed'
import { AMBIENT_CONDITIONS_QUERY_KEY } from './ambient-conditions'
import { queryHistoryKey } from './query-history'

const MAXIMUM_CACHED_CONVERSATIONS = 5
const MAXIMUM_HISTORY_PAGES = 10
const METADATA_REFRESH_DELAY_MS = 100
const DISCLOSURE_REFRESH_DELAY_MS = 600
const MAXIMUM_NOTIFIED_TURN_ERRORS = 128

interface HistoryCursor {
  before?: string
  after?: string
}

export interface CachedConversationPage extends ConversationPage {
  snapshotVersion: string
  appliedCursor: number
}
export type CachedConversation = InfiniteData<CachedConversationPage, HistoryCursor>

/**
 * Captures the immutable page frontier before a live subscription attaches.
 */
async function fetchConversationPage(profile: string, sessionId: string, cursor: HistoryCursor = {}, signal?: AbortSignal): Promise<CachedConversationPage> {
  const params = new URLSearchParams({ limit: String(SESSION_PAGE_SIZE), ...cursor })
  const page = await requestAPI<ConversationPage>(`sessions/${encodeURIComponent(sessionId)}?${params}`,
    signal ? { signal } : {})
  const cached = queryClient.getQueryData<CachedConversation>(['conversation', profile, sessionId])
  const liveRecords = new Map(cached?.pages.flatMap((item) => item.messages.filter((record) => !record.historical).map((record) => [record.messageId, record] as const)))

  return {
    ...page, snapshotVersion: crypto.randomUUID(), appliedCursor: page.event_cursor,
    messages: page.messages.map((record) => {
      const live = liveRecords.get(record.messageId)
      return { ...record, historical: record.isAddedToHistory && !live,
        ...(live?.draftGeneration ? { draftGeneration: live.draftGeneration } : {}) }
    })
  }
}

/**
 * Restores the latest window without retaining an unbounded transcript cache.
 */
async function returnToLatest(profile: string, sessionId: string): Promise<void> {
  const key = conversationQueryOptions(profile, sessionId).queryKey
  await queryClient.cancelQueries({ queryKey: key, exact: true })
  const page = await queryClient.fetchQuery({
    queryKey: ['conversation-latest', profile, sessionId],
    meta: { errorTitle: 'Could not load the latest messages', profile },
    queryFn: ({ signal }) => fetchConversationPage(profile, sessionId, {}, signal),
    staleTime: 0,
    gcTime: 0
  })
  // Cache eviction or a profile change must not resurrect an obsolete window.
  if (queryClient.getQueryState(key)) {
    queryClient.setQueryData<CachedConversation>(key, { pages: [page], pageParams: [{}] })
  }
}

/**
 * Keeps latest history separate from older pages and from heavyweight disclosures.
 */
export function conversationQueryOptions(profile: string, sessionId: string): UseInfiniteQueryOptions<
  CachedConversationPage, Error, CachedConversation, string[], HistoryCursor
> {
  return infiniteQueryOptions({
    queryKey: ['conversation', profile, sessionId],
    enabled: Boolean(profile && sessionId),
    meta: { errorTitle: 'Could not load the conversation', profile },
    initialPageParam: {} as HistoryCursor,
    queryFn: ({ pageParam, signal }) => fetchConversationPage(profile, sessionId, pageParam, signal),
    getNextPageParam: (page) => page.next_cursor ? { before: page.next_cursor } : undefined,
    getPreviousPageParam: (page) => page.newer_cursor ? { after: page.newer_cursor } : undefined,
    maxPages: MAXIMUM_HISTORY_PAGES,
    refetchOnWindowFocus: false
  })
}

/**
 * Opens only the newest cached window before observers can refetch older pages.
 */
export function prepareConversationForNavigation(profile: string, sessionId: string): void {
  const key = conversationQueryOptions(profile, sessionId).queryKey
  const state = queryClient.getQueryState<CachedConversation>(key)
  let cached = state?.data
  if (cached?.pages.some((page) => page.messages.some((record) => !record.historical && record.isAddedToHistory))) {
    // Deliberate navigation reopens saved content without replaying live reveals.
    cached = {
      ...cached, pages: cached.pages.map((page) => ({ ...page,
        messages: page.messages.map((record) => record.isAddedToHistory ? { ...record, historical: true } : record)
      }))
    }
    queryClient.setQueryData<CachedConversation>(key, cached)
  }
  if (!state || !cached || cached.pages.length === 1 && !cached.pages[0]?.newer_cursor) {
    return
  }

  // Cancel obsolete pagination before changing its page parameters.
  void queryClient.cancelQueries({ queryKey: key, exact: true })
  const latest = cached.pages.find((page) => !page.newer_cursor)
  if (latest) {
    queryClient.setQueryData<CachedConversation>(key, {
      pages: [latest], pageParams: [{}]
    }, { updatedAt: state.dataUpdatedAt })
  } else {
    // Bounded history can evict the newest page; its next request must be latest.
    void queryClient.resetQueries({ queryKey: key, exact: true })
  }
}

/**
 * Bounds inactive conversation caches while preserving fast recent navigation.
 */
function pruneConversationCaches(activeKey: readonly unknown[]): void {
  const inactive = queryClient.getQueryCache().findAll({ queryKey: ['conversation'], type: 'inactive' })
    .filter((query) => JSON.stringify(query.queryKey) !== JSON.stringify(activeKey))
    .sort((left, right) => right.state.dataUpdatedAt - left.state.dataUpdatedAt)
  for (const query of inactive.slice(MAXIMUM_CACHED_CONVERSATIONS)) {
    queryClient.removeQueries({ queryKey: query.queryKey, exact: true })
  }
}

/**
 * Projects stable feed rows; only changed response records are rebuilt on tokens.
 */
export function useConversation(sessionId: string): UseInfiniteQueryResult<CachedConversation, Error> & {
  entries: FeedEntry[]
  historicalIds: string[]
  latest: CachedConversationPage | undefined
  returnToLatest: () => Promise<void>
} {
  const profile = useProfile()
  const options = conversationQueryOptions(profile, sessionId)
  const result = useInfiniteQuery(options)
  const latest = result.data?.pages[0]
  const records = useMemo(() => {
    const unique = new Map<string, ConversationRecord>()
    for (const page of [...(result.data?.pages ?? [])].reverse()) {
      for (const record of page.messages) {
        unique.set(record.messageId, record)
      }
    }

    return [...unique.values()].sort((left, right) => left.sentAt - right.sentAt)
  }, [result.data])
  const entries = useMemo(() => records.map((record) => toFeedEntry(record, latest?.is_running ?? false)),
    [records, latest?.is_running])
  const historicalIds = useMemo(() => records.filter((record) => record.historical).flatMap((record) => [
    record.messageId,
    ...(record.agentResponseTrace?.id ? [record.agentResponseTrace.id] : []),
    ...(record.agentResponseTrace?.reasoning?.map((block) => block.id) ?? []),
    ...(record.agentResponseTrace?.progressMessages?.map((message) => message.id) ?? []),
    ...(record.agentResponseTrace?.toolCalls.map((call) => call.id) ?? [])
  ]), [records])

  useEffect(() => pruneConversationCaches(options.queryKey), [profile, sessionId])

  return { ...result, entries, historicalIds, latest, returnToLatest: () => returnToLatest(profile, sessionId) }
}

/**
 * Adds input immediately; a stable ID is retained on retry after uncertain delivery.
 */
export function useSendMessage(sessionId: string): UseMutationResult<{ command: ConversationCommand }, Error, { id: string, query: string }> {
  const profile = useProfile()
  const key = conversationQueryOptions(profile, sessionId).queryKey
  const { showToast } = useToast()

  return useMutation({
    meta: { errorTitle: 'Message delivery was not confirmed', profile },
    mutationFn: (input: { id: string, query: string }) => requestAPI<{ command: ConversationCommand }>(`sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: 'POST', body: JSON.stringify(input)
    }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: key, exact: true })
      const current = queryClient.getQueryData<CachedConversation>(key)?.pages[0]
      if (current?.newer_cursor) {
        await returnToLatest(profile, sessionId)
      }
      queryClient.setQueryData<CachedConversation>(key, (previous) => {
        if (!previous?.pages[0]) {
          return previous
        }
        const page = previous.pages[0]
        const messages = [...page.messages]
        if (!messages.some((message) => message.messageId === input.id)) {
          messages.push({ who: 'owner', messageId: input.id, message: input.query, sentAt: Date.now(), isAddedToHistory: true })
          messages.push({ who: 'leon', messageId: `${input.id}:leon`, message: '', sentAt: Date.now(), isAddedToHistory: false })
        }

        return { ...previous, pages: [{ ...page, messages, is_running: true }, ...previous.pages.slice(1)] }
      })
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: key, exact: true })
    },
    onSuccess: ({ command }) => {
      void queryClient.invalidateQueries({ queryKey: queryHistoryKey(profile, sessionId), exact: true })
      if (command.status !== 'accepted') {
        void queryClient.invalidateQueries({ queryKey: key, exact: true })
      }
      if (command.status === 'interrupted') {
        showToast({ type: 'info', title: 'This request was interrupted',
          description: 'Your saved work is available. Send a new message to resume it.' })
      }
    },
    onSettled: (): void => {
      void queryClient.invalidateQueries({ queryKey: [...sessionsQueryKey, profile] })
    }
  })
}

/**
 * Owns one browser-managed reconnect loop; navigation never cancels server work.
 * Each fresh snapshot restarts replay at its atomically captured event frontier.
 */
export function useConversationEvents(sessionId: string | undefined, snapshot: CachedConversationPage | undefined, sidebarCursor?: number): void {
  const profile = useProfile()
  const disconnectedRef = useRef(false)
  const notifiedTurnErrorsRef = useRef(new Set<string>())
  useEffect(() => {
    if (!profile || sessionId && !snapshot || !sessionId && sidebarCursor === undefined) {
      return
    }
    const params = new URLSearchParams({ after: String(snapshot?.event_cursor ?? sidebarCursor ?? 0) })
    if (sessionId && !snapshot?.newer_cursor) {
      params.set('session_id', sessionId)
    }
    const source = new EventSource(`/api/v1/sessions/events?${params}`, { withCredentials: true })
    let disposed = false
    const key = sessionId ? conversationQueryOptions(profile, sessionId).queryKey : undefined
    let metadataTimer: ReturnType<typeof setTimeout> | undefined
    let disclosureTimer: ReturnType<typeof setTimeout> | undefined
    const refreshMetadata = (): void => {
      if (metadataTimer === undefined) {
        // One turn changes several projections in a burst. Coalesce their
        // invalidations without putting token or WIP delivery on a timer.
        metadataTimer = setTimeout(() => {
          metadataTimer = undefined
          if (source.readyState !== EventSource.CLOSED) {
            void queryClient.invalidateQueries({ queryKey: [...sessionsQueryKey, profile] })
          }
        }, METADATA_REFRESH_DELAY_MS)
      }
    }
    source.onopen = (): void => {
      if (disposed) {
        return
      }
      if (disconnectedRef.current) {
        void queryClient.invalidateQueries({ queryKey: [...AMBIENT_CONDITIONS_QUERY_KEY, profile], exact: true })
      }
      disconnectedRef.current = false
      refreshMetadata()
    }
    source.onmessage = (message): void => {
      if (disposed) {
        return
      }
      const notification = JSON.parse(String(message.data)) as ConversationNotification
      // Metadata notifications do not carry a conversation payload or cursor.
      if (notification.type === 'sessions_changed') {
        refreshMetadata()
        return
      }
      if (!('data' in notification)) {
        return
      }
      const event = notification
      if (event.type === 'owner_message' || event.type === 'error' && event.data['code'] === 'replay_snapshot_required') {
        void queryClient.invalidateQueries({ queryKey: queryHistoryKey(profile, event.session_id || sessionId || ''), exact: true })
      }
      if (event.type === 'mood_changed') {
        void queryClient.invalidateQueries({ queryKey: [...AMBIENT_CONDITIONS_QUERY_KEY, profile], exact: true })
        return
      }
      const status = event.type === 'turn_status' && event.data['status'] === 'accepted' ? SessionStatus.Wip
        : event.type === 'session_changed' && typeof event.data['is_running'] === 'boolean'
          ? event.data['is_running'] ? SessionStatus.Wip : SessionStatus.Idle : undefined
      if (status !== undefined) {
        queryClient.setQueriesData<InfiniteData<SessionsPage>>({ queryKey: [...sessionsQueryKey, profile] }, (previous) => previous ? {
          ...previous, pages: previous.pages.map((page) => ({ ...page, sessions: page.sessions.map((session) =>
            session.id === event.session_id ? { ...session, status } : session) }))
        } : previous)
      }
      if (event.type === 'session_changed' || event.type === 'turn_status') {
        refreshMetadata()
      }
      if (event.type === 'error' && event.data['code'] === 'replay_snapshot_required') {
        if (key) {
          void queryClient.invalidateQueries({ queryKey: key, exact: true })
        }
        refreshMetadata()
        return
      }
      const isNewError = event.type === 'error' && event.session_id === sessionId &&
        event.sequence > (key ? queryClient.getQueryData<CachedConversation>(key)?.pages[0]?.appliedCursor ?? 0 : 0)
      const isOffscreenError = event.type === 'turn_status' && event.data['status'] === 'error' &&
        event.session_id !== sessionId
      if (isNewError || isOffscreenError) {
        const errorId = event.turn_id ?? event.response_id ?? String(event.sequence)
        const notified = notifiedTurnErrorsRef.current
        if (!notified.has(errorId)) {
          notified.add(errorId)
          if (notified.size > MAXIMUM_NOTIFIED_TURN_ERRORS) {
            notified.delete(notified.values().next().value!)
          }
          requestErrors.report(new Error(isNewError && typeof event.data['message'] === 'string'
            ? event.data['message'] : 'Open this session to review the saved error and try again.'), {
            errorTitle: 'I could not finish the turn', profile
          })
        }
      }
      if (key && event.session_id === sessionId) {
        if (event.type === 'tool_call' && disclosureTimer === undefined) {
          disclosureTimer = setTimeout(() => {
            disclosureTimer = undefined
            void queryClient.invalidateQueries({
              queryKey: ['conversation-details', profile, sessionId, event.response_id], exact: true
            })
          }, DISCLOSURE_REFRESH_DELAY_MS)
        }
        queryClient.setQueryData<CachedConversation>(key, (previous) => {
          const page = previous?.pages[0]
          if (!previous || !page || event.sequence <= page.appliedCursor) {
            return previous
          }
          const running = event.type === 'session_changed' && typeof event.data['is_running'] === 'boolean'
            ? event.data['is_running'] : event.type === 'turn_status' && event.data['status'] === 'accepted' ? true : page.is_running

          return { ...previous, pages: [{
            ...page, appliedCursor: event.sequence, is_running: running,
            messages: page.newer_cursor ? page.messages : applyConversationEvent(page.messages, event)
          }, ...previous.pages.slice(1)] }
        })
        if (event.type === 'session_changed' && event.data['is_running'] === false) {
          void queryClient.invalidateQueries({ queryKey: key, exact: true })
        }
        if (event.type === 'final_answer' || event.type === 'error') {
          void queryClient.invalidateQueries({ queryKey: ['conversation-details', profile, sessionId] })
        }
      }
    }
    source.onerror = (): void => {
      if (disposed) {
        return
      }
      if (!disconnectedRef.current) {
        disconnectedRef.current = true
        requestErrors.report(new ConnectionError(navigator.onLine
          ? 'Live updates are disconnected. I’ll reconnect automatically.' : undefined), {
          errorTitle: 'Connection interrupted', errorType: 'warning', profile
        })
      }
      // Let EventSource own retries; auth is independently rechecked on failure.
      void queryClient.invalidateQueries({ queryKey: PROFILE_AUTH_QUERY_KEY })
    }

    return (): void => {
      disposed = true
      source.onopen = null
      source.onmessage = null
      source.onerror = null
      source.close()
      clearTimeout(metadataTimer)
      clearTimeout(disclosureTimer)
    }
  }, [profile, sessionId, snapshot?.snapshotVersion, sidebarCursor])
}
