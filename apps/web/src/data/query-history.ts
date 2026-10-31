import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'

import { queryClient } from '@/query-client'
import { requestAPI } from './api'
import type { ConversationRecord } from './conversation'
import { useProfile } from './profile'

const MAXIMUM_QUERIES = 128
// UTF-16 text uses at most 2 MiB, independently of the number of long prompts.
const MAXIMUM_CHARACTERS = 1_024 * 1_024
const PAGE_SIZE = 50

interface QueryHistoryPage {
  queries: Pick<ConversationRecord, 'messageId' | 'message'>[]
  next_cursor: string | null
  remainingQueries: number
  remainingCharacters: number
}

interface HistoryCursor {
  before?: string
  remainingQueries: number
  remainingCharacters: number
}

/**
 * Scopes recalled input to its authenticated profile and conversation.
 */
export function queryHistoryKey(profile: string, sessionId: string): string[] {
  return ['query-history', profile, sessionId]
}

/**
 * Fetches text only on keyboard demand; the current composer's bounded cache is
 * released on navigation rather than retaining every visited session's prompts.
 */
export function useQueryHistory(sessionId?: string): {
  read: (index: number, start: boolean) => Promise<string | undefined>
} {
  const profile = useProfile()
  const key = queryHistoryKey(profile, sessionId ?? '')
  const history = useInfiniteQuery({
    queryKey: key,
    enabled: false,
    meta: { errorTitle: 'Could not load query history', profile },
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    initialPageParam: {
      remainingQueries: MAXIMUM_QUERIES, remainingCharacters: MAXIMUM_CHARACTERS
    } as HistoryCursor,
    queryFn: async ({ pageParam, signal }): Promise<QueryHistoryPage> => {
      const params = new URLSearchParams({
        limit: String(Math.min(PAGE_SIZE, pageParam.remainingQueries)),
        characters: String(pageParam.remainingCharacters),
        ...(pageParam.before ? { before: pageParam.before } : {})
      })
      const page = await requestAPI<Pick<QueryHistoryPage, 'queries' | 'next_cursor'>>(
        `sessions/${encodeURIComponent(sessionId!)}/queries?${params}`, { signal }
      )

      return {
        ...page,
        remainingQueries: pageParam.remainingQueries - page.queries.length,
        remainingCharacters: pageParam.remainingCharacters - page.queries.reduce((sum, query) => sum + query.message.length, 0)
      }
    },
    getNextPageParam: (page): HistoryCursor | undefined => {
      if (!page.next_cursor || page.remainingQueries <= 0 || page.remainingCharacters <= 0) {
        return undefined
      }

      return {
        before: page.next_cursor,
        remainingQueries: page.remainingQueries,
        remainingCharacters: page.remainingCharacters
      }
    }
  })

  async function read(index: number, start: boolean): Promise<string | undefined> {
    if (!profile || !sessionId || index < 0 || index >= MAXIMUM_QUERIES) {
      return undefined
    }

    // Refresh only when starting another browse, never shift a recalled entry
    // beneath the user or refetch every older page after a new submitted query.
    if (start && queryClient.getQueryState(key)?.isInvalidated) {
      await queryClient.resetQueries({ queryKey: key, exact: true })
    }

    let data = queryClient.getQueryData<InfiniteData<QueryHistoryPage>>(key)
    if (!data) {
      data = (await history.refetch({ throwOnError: true })).data
    }

    let offset = index
    for (const page of data?.pages ?? []) {
      if (offset < page.queries.length) {
        return page.queries[offset]?.message
      }
      offset -= page.queries.length
    }

    if (data && history.hasNextPage) {
      const next = await history.fetchNextPage({ cancelRefetch: false, throwOnError: true })

      return next.data?.pages.at(-1)?.queries[offset]?.message
    }

    return undefined
  }

  return { read }
}
