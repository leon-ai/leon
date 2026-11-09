import { useMutation, type UseMutationResult } from '@tanstack/react-query'
import { useRef } from 'react'
import type { AnswerPart, AuroraValues } from '../../../../aurora/src/v2/contracts/answer'
import { queryClient } from '@/query-client'
import { requestAPI } from './api'
import { useProfile, PROFILE_AUTH_QUERY_KEY } from './profile'
import { conversationQueryOptions, type CachedConversation } from './conversation-queries'
import { queryHistoryKey } from './query-history'
import { mergeAnswerParts } from './conversation-events'

/**
 * Reuses one command ID through uncertain delivery, with no automatic request replay.
 * Only an accepted server receipt changes the saved UI or creates an owner turn.
 */
export function useAuroraSubmission(
  sessionId: string, messageId: string, surfaceId: string, nodeId: string, revision: number
): UseMutationResult<{ answerParts: AnswerPart[] }, Error, AuroraValues> {
  const profile = useProfile()
  const commandId = useRef<string | undefined>(undefined)

  return useMutation({
    meta: { errorTitle: 'I could not save your answer', profile },
    retry: false,
    mutationFn: (values: AuroraValues) => {
      commandId.current ??= crypto.randomUUID()

      return requestAPI<{ answerParts: AnswerPart[] }>(
        `sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}/ui`,
        { method: 'POST', body: JSON.stringify({ id: commandId.current, surfaceId, nodeId, revision, values }) }
      )
    },
    onSuccess: ({ answerParts }) => {
      if (queryClient.getQueryData<{ profile_name: string | null }>(PROFILE_AUTH_QUERY_KEY)?.profile_name !== profile) {
        return
      }

      const key = conversationQueryOptions(profile, sessionId).queryKey
      queryClient.setQueryData<CachedConversation>(key, (previous) => previous ? { ...previous,
        pages: previous.pages.map((page) => ({ ...page, messages: page.messages.map((record) =>
          record.messageId === messageId ? { ...record, answerParts: mergeAnswerParts(record.answerParts, answerParts) } : record) })) } : previous)
      void queryClient.invalidateQueries({ queryKey: key, exact: true })
      void queryClient.invalidateQueries({ queryKey: queryHistoryKey(profile, sessionId), exact: true })
    }
  })
}
