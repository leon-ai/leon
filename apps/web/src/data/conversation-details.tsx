import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'

import { requestAPI } from './api'
import type { ConversationRecord } from './conversation'
import { useProfile } from './profile'

const DetailsContext = createContext<{ sessionId: string, messageId: string } | null>(null)

/**
 * Gives nested disclosures one shared, lazily fetched response payload.
 */
export function ConversationDetailsProvider({ sessionId, messageId, children }: {
  sessionId: string | undefined
  messageId: string
  children: ReactNode
}) {
  const context = useMemo(() => sessionId ? { sessionId, messageId } : null, [sessionId, messageId])

  return (
    <DetailsContext value={context}>
      {children}
    </DetailsContext>
  )
}

/**
 * Heavy reasoning and tool bodies are requested only when a disclosure needs them.
 */
export function useConversationDetails(enabled: boolean) {
  const context = useContext(DetailsContext)
  const profile = useProfile()

  return useQuery({
    queryKey: ['conversation-details', profile, context?.sessionId, context?.messageId],
    meta: { errorTitle: 'Could not load response details', profile },
    queryFn: ({ signal }) => requestAPI<{ message: ConversationRecord }>(
      `sessions/${encodeURIComponent(context?.sessionId ?? '')}/messages/${encodeURIComponent(context?.messageId ?? '')}`,
      { signal }
    ),
    enabled: enabled && Boolean(profile) && context !== null,
    staleTime: 0,
    gcTime: 60_000
  })
}
