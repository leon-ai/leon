import { QueryClient } from '@tanstack/react-query'
import { APIError, requestErrors } from '@/data/request-errors'

const QUERY_STALE_TIME = 60_000

export const queryClient = new QueryClient({
  queryCache: requestErrors.queryCache,
  mutationCache: requestErrors.mutationCache,
  defaultOptions: {
    queries: {
      staleTime: QUERY_STALE_TIME,
      gcTime: 5 * 60_000,
      retry: (count, error): boolean => !(error instanceof APIError && error.status < 500) && count < 1
    }
  }
})
