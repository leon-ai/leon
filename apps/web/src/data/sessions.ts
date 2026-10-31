import { infiniteQueryOptions, useInfiniteQuery, useMutation,
  type UseInfiniteQueryOptions, type UseInfiniteQueryResult, type InfiniteData, type UseMutationResult } from '@tanstack/react-query'
import { useMemo } from 'react'
import { queryClient } from '@/query-client'
import { requestAPI } from './api'
import type { ModelSettings } from './model-catalog'
import { useToast } from '@/components/toast'
import { PROFILE_AUTH_QUERY_KEY } from './profile-query'
import type { ProfileAuthentication } from '../../../../server/src/core/http-server/profile-auth-contract'

export enum SessionStatus {
  Idle = 'idle',
  Wip = 'wip'
}

export interface ConversationSession {
  id: string
  title: string
  isTitleGenerated: boolean
  isPinned: boolean
  status: SessionStatus
  createdAt: number
  updatedAt: number
  lastMessageAt: number | null
  messageCount: number
  modelTarget: string | null
  modelSettings?: Record<string, Partial<ModelSettings>>
}

export interface ConversationSessionIndex {
  activeSessionId: string
  sessions: ConversationSession[]
}

export interface SessionsPage {
  sessions: ConversationSession[]
  next_cursor: string | null
  event_cursor: number
}

export const sessionsQueryKey = ['sessions'] as const
export const SESSION_PAGE_SIZE = 40

/**
 * Shares indexed pagination between the sidebar and session search.
 */
export function sessionsQueryOptions(profile: string, query = ''): UseInfiniteQueryOptions<
  SessionsPage, Error, InfiniteData<SessionsPage>, string[], string | null
> {
  return infiniteQueryOptions({
    queryKey: [...sessionsQueryKey, profile, query],
    meta: { errorTitle: query ? 'Could not search sessions' : 'Could not load sessions', profile },
    enabled: Boolean(profile),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: String(SESSION_PAGE_SIZE), query })
      if (pageParam) {
        params.set('cursor', pageParam)
      }

      return requestAPI<SessionsPage>(`sessions/page?${params}`, { signal })
    },
    getNextPageParam: (page) => page.next_cursor ?? undefined
  })
}

/**
 * Fetches pages only as the owner approaches the end of a virtualized list.
 */
export function useSessions(profile: string, query = ''): UseInfiniteQueryResult<InfiniteData<SessionsPage>, Error> & {
  sessions: ConversationSession[]
} {
  const result = useInfiniteQuery(sessionsQueryOptions(profile, query))
  const sessions = useMemo(() => {
    const unique = new Map<string, ConversationSession>()
    for (const page of result.data?.pages ?? []) {
      for (const session of page.sessions) {
        if (!unique.has(session.id)) {
          unique.set(session.id, session)
        }
      }
    }

    return [...unique.values()]
  }, [result.data])

  return { ...result, sessions }
}

/**
 * Invalidates shared metadata after authoritative CRUD operations.
 */
export function useSessionMutation(profile: string): UseMutationResult<
  { session: ConversationSession }, Error, { id: string, changes?: { title?: string, is_pinned?: boolean } }
> {
  const { showToast } = useToast()

  return useMutation({
    meta: { errorTitle: 'Session could not be updated', profile },
    mutationFn: ({ id, changes }: { id: string, changes?: { title?: string, is_pinned?: boolean } }) =>
      requestAPI<{ session: ConversationSession }>(`sessions/${encodeURIComponent(id)}?compact=true`, {
        method: changes ? 'PATCH' : 'DELETE',
        ...(changes ? { body: JSON.stringify(changes) } : {})
      }),
    onSuccess: (_result, { changes }) => {
      if (queryClient.getQueryData<ProfileAuthentication>(PROFILE_AUTH_QUERY_KEY)?.profile_name !== profile) {
        return
      }
      const action = !changes ? 'deleted'
        : changes.title !== undefined ? 'renamed'
          : changes.is_pinned ? 'pinned' : 'unpinned'

      showToast({
        type: 'success', title: `Session ${action}`,
        description: changes?.title ?? `I've ${action} the session.`
      })
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: sessionsQueryKey })
  })
}
