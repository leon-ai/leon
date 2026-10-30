import { useParams } from '@tanstack/react-router'
import { useInfiniteQuery } from '@tanstack/react-query'

import { useProfile } from './profile'
import { useSessions } from './sessions'
import { conversationQueryOptions, useConversationEvents } from './conversation-queries'

/**
 * Keeps one connection at layout lifetime rather than one per feed component.
 */
export function ConversationConnection() {
  const profile = useProfile()
  const { sessionId } = useParams({ strict: false })
  const sessions = useSessions(profile)
  const detail = useInfiniteQuery({
    ...conversationQueryOptions(profile, sessionId ?? ''), enabled: Boolean(profile && sessionId)
  })
  useConversationEvents(sessionId, sessionId ? detail.data?.pages[0] : undefined,
    sessionId ? undefined : sessions.data?.pages[0]?.event_cursor)

  return null
}
