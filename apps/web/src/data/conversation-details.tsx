import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'

import { requestAPI } from './api'
import type { ConversationRecord } from './conversation'
import { useProfile } from './profile'
import type { ToolCallContents } from '../../../../server/src/core/session-manager/tool-content-contract'

export const ConversationDetailsContext = createContext<{ sessionId: string, messageId: string } | null>(null)

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
    <ConversationDetailsContext value={context}>
      {children}
    </ConversationDetailsContext>
  )
}

/**
 * Heavy reasoning and tool bodies are requested only when a disclosure needs them.
 */
export function useConversationDetails(enabled: boolean) {
  const context = useContext(ConversationDetailsContext)
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

/**
 * Fetches bounded invocation previews separately from explicitly requested full bodies.
 * Both share the turn's existing event-driven invalidation and profile isolation.
 */
export function useToolCallContents(toolId: string, enabled: boolean, complete = false) {
  const context = useContext(ConversationDetailsContext)
  const profile = useProfile()

  return useQuery({
    queryKey: ['conversation-details', profile, context?.sessionId, context?.messageId, 'tools', toolId, complete],
    meta: { errorTitle: 'Could not load tool details', profile },
    queryFn: ({ signal }) => requestAPI<ToolCallContents>(
      `sessions/${encodeURIComponent(context?.sessionId ?? '')}/messages/${encodeURIComponent(context?.messageId ?? '')}/tools/${encodeURIComponent(toolId)}?complete=${complete}`,
      { signal }
    ),
    enabled: enabled && Boolean(profile) && context !== null,
    staleTime: 0,
    // Full bodies belong only to the open inspector, not the conversation cache.
    gcTime: complete ? 0 : 60_000
  })
}
