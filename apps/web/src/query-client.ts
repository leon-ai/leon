import { QueryClient } from '@tanstack/react-query'

const QUERY_STALE_TIME = 60_000

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: QUERY_STALE_TIME
    }
  }
})
