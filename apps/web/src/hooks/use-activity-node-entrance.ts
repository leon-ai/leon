import { useContext } from 'react'

import { useAnimateOnce } from '@/components/streaming-text'
import { ConversationDetailsContext } from '@/data/conversation-details'

/**
 * Reveals new activity once per response, including rows with IDs shared across plans.
 */
export function useActivityNodeEntrance(nodeId: string, enabled = true): boolean {
  const conversation = useContext(ConversationDetailsContext)
  const responseId = conversation ? `${conversation.messageId}:` : ''

  return useAnimateOnce(`${responseId}${nodeId}:activity-entrance`, enabled)
}
