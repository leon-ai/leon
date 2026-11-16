import { infiniteQueryOptions, useInfiniteQuery, useMutation, useQuery,
  type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

import { requestAPI } from './api'
import { queryClient } from '@/query-client'
import { sessionsQueryKey, useSessions, type ConversationSession } from './sessions'
import { useToast } from '@/components/toast'
import { PROFILE_AUTH_QUERY_KEY } from './profile'
import type { Workspace, WorkspaceInput, WorkspaceSummary } from '../../../../bridges/runtime/contracts/workspace'

export type { Workspace, WorkspaceInput, WorkspaceSummary }
export const workspacesQueryKey = ['workspaces'] as const

export type RecentItem = { kind: 'workspace', value: WorkspaceSummary } | { kind: 'session', value: ConversationSession }
interface RecentsPage {
  items: RecentItem[]
  next_cursor: string | null
}

/**
 * Shares lightweight resource context across the composer, settings and sidebar.
 */
export function useWorkspaces(profile: string): UseQueryResult<{ workspaces: WorkspaceSummary[] }, Error> {
  return useQuery({
    queryKey: [...workspacesQueryKey, profile, 'list'], enabled: Boolean(profile),
    meta: { profile, errorTitle: 'I couldn’t load your workspaces' },
    queryFn: ({ signal }) => requestAPI<{ workspaces: WorkspaceSummary[] }>('workspaces', { signal })
  })
}

/**
 * Pages the mixed navigation catalog without downloading grouped history.
 */
export function useRecents(profile: string): {
  items: RecentItem[]
  isPending: boolean
  isFetching: boolean
  isError: boolean
  hasNextPage: boolean
  fetchNextPage: () => Promise<unknown>
  refetch: () => Promise<unknown>
} {
  const catalog = useWorkspaces(profile)
  const sessions = useSessions(profile)
  const grouped = Boolean(catalog.data?.workspaces.length)
  const result = useInfiniteQuery(infiniteQueryOptions({
    queryKey: [...workspacesQueryKey, profile, 'recents'], enabled: Boolean(profile && grouped),
    initialPageParam: null as string | null,
    meta: { profile, errorTitle: 'I couldn’t load your recent conversations' },
    queryFn: ({ pageParam, signal }) => requestAPI<RecentsPage>(`workspaces/recents?${new URLSearchParams({
      limit: '40', ...(pageParam ? { cursor: pageParam } : {})
    })}`, { signal }),
    getNextPageParam: (page) => page.next_cursor ?? undefined
  }))
  const items = useMemo<RecentItem[]>(() => !catalog.data ? [] : grouped
    ? [...new Map(result.data?.pages.flatMap((page) => page.items.map((item) => [item.value.id, item] as const))).values()]
    : sessions.sessions.map((session) => ({ kind: 'session', value: session })), [catalog.data, grouped, result.data, sessions.sessions])
  const active = grouped ? result : sessions
  const refetch = useCallback(() => Promise.all([catalog.refetch(), active.refetch()]), [catalog.refetch, active.refetch])

  return { items, isPending: catalog.isPending || active.isPending, isFetching: active.isFetching,
    isError: catalog.isError || active.isError, hasNextPage: active.hasNextPage,
    fetchNextPage: active.fetchNextPage, refetch }
}

/**
 * Keeps the project catalog and session metadata consistent after durable writes.
 */
export function useWorkspaceMutation(profile: string): UseMutationResult<
  { workspace?: Workspace }, Error, { id?: string, input?: WorkspaceInput, pinned?: boolean }
> {
  const { showToast } = useToast()

  return useMutation({
    meta: { profile, errorTitle: 'I couldn’t update this workspace' },
    mutationFn: ({ id, input, pinned }: { id?: string, input?: WorkspaceInput, pinned?: boolean }) => requestAPI<{ workspace?: Workspace }>(
      `workspaces${id ? `/${encodeURIComponent(id)}` : ''}`,
      { method: pinned !== undefined ? 'PATCH' : input ? id ? 'PUT' : 'POST' : 'DELETE',
        ...(pinned !== undefined ? { body: JSON.stringify({ is_pinned: pinned }) } : input ? { body: JSON.stringify(input) } : {}) }
    ),
    onSuccess: (_result, { id, input, pinned }) => {
      if (queryClient.getQueryData<{ profile_name: string }>(PROFILE_AUTH_QUERY_KEY)?.profile_name === profile) {
        showToast({ type: 'success', title: pinned !== undefined ? pinned ? 'Workspace pinned' : 'Workspace unpinned' : input ? id ? 'Workspace saved' : 'Workspace created' : 'Workspace deleted',
          description: input?.name ?? (pinned === undefined ? 'Your conversations are still in Recents.' : '') })
      }
    },
    onSettled: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: [...workspacesQueryKey, profile] }),
      queryClient.invalidateQueries({ queryKey: [...sessionsQueryKey, profile] })
    ])
  })
}
