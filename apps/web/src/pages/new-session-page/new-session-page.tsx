import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import { QueryInput } from '@/components/query-input'
import { RequestFeedback } from '@/components/request-feedback/request-feedback'
import { requestAPI } from '@/data/api'
import { useProfile } from '@/data/profile'
import { useComposerModel } from '@/data/composer-model'
import { conversationQueryOptions, useSendMessage } from '@/data/conversation-queries'
import type { ConversationSession } from '@/data/sessions'
import { queryClient } from '@/query-client'

import './new-session-page.sass'

const REDUCED_MOTION_MEDIA_QUERY = '(prefers-reduced-motion: reduce)'

export function NewSessionPage() {
  const navigate = useNavigate()
  const profile = useProfile()
  const model = useComposerModel()
  const [sessionId] = useState(() => crypto.randomUUID())
  const send = useSendMessage(sessionId)
  const create = useMutation({
    meta: { errorTitle: 'Could not start the session', profile },
    mutationFn: async ({ id, query }: { id: string, query: string }) => {
      await requestAPI<{ session: ConversationSession }>('sessions?compact=true', {
        method: 'POST', body: JSON.stringify({ id: sessionId })
      })
      if (model.hasChanges && model.selection) {
        await requestAPI(`sessions/${sessionId}/model`, {
          method: 'PATCH', body: JSON.stringify({
            provider: model.selection.provider, model: model.selection.model, ...model.selection.settings
          })
        })
      }
      await queryClient.fetchInfiniteQuery(conversationQueryOptions(profile, sessionId))
      await send.mutateAsync({ id, query })
    },
    onSuccess: () => transitionToSession()
  })

  function transitionToSession(): void {
    const navigateToSession = () => navigate({
      to: '/session/$sessionId',
      params: { sessionId }
    })

    if (
      !('startViewTransition' in document) ||
      window.matchMedia(REDUCED_MOTION_MEDIA_QUERY).matches
    ) {
      void navigateToSession()
      return
    }

    document.startViewTransition(navigateToSession)
  }

  return (
    <div className="new-session-page">
      <div className="new-session-page-composer">
        <QueryInput autoFocus introWave model={model} loading={create.isPending} canSubmit={!model.pending}
          onSubmit={(query) => create.mutate({ id: crypto.randomUUID(), query })} />
        {(create.isError || create.isPaused) && (
          <RequestFeedback error={create.error} paused={create.isPaused}
            onRetry={() => create.variables && create.mutate(create.variables)} />
        )}
      </div>
    </div>
  )
}
