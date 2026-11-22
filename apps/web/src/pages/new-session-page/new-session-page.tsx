import { useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import { QueryInput } from '@/components/query-input'
import { WorkspaceSelector } from '@/components/workspace-selector/workspace-selector'
import '@/components/workspace-dialog/workspace-dialog.sass'
import { RequestFeedback } from '@/components/request-feedback/request-feedback'
import { requestAPI } from '@/data/api'
import { PROFILE_AUTH_QUERY_KEY, useProfile } from '@/data/profile'
import { useComposerModel } from '@/data/composer-model'
import { conversationQueryOptions, useSendMessage } from '@/data/conversation-queries'
import type { ConversationSession } from '@/data/sessions'
import { queryClient } from '@/query-client'
import { prefetchModule } from '@/utils/prefetch'
import { createUUID } from '@/utils/create-uuid'
import type { SendMessageInput } from '@/data/owner-attachments'
import { assertSendMessageActive, createSendMessageInput } from '@/data/owner-attachments'

import './new-session-page.sass'

const REDUCED_MOTION_MEDIA_QUERY = '(prefers-reduced-motion: reduce)'

export function NewSessionPage() {
  const navigate = useNavigate()
  const profile = useProfile()
  const { workspace } = useSearch({ strict: false })
  const workspaceId = workspace ?? null
  const model = useComposerModel()
  const [intent, setIntent] = useState(() => ({ sessionId: createUUID(), workspaceId }))
  const { sessionId } = intent
  const send = useSendMessage(sessionId)
  const create = useMutation({
    meta: { errorTitle: 'Could not start the session', profile },
    gcTime: 0,
    mutationFn: async (input: SendMessageInput) => {
      assertSendMessageActive(profile, input.signal)
      prefetchModule(() => import('@/components/markdown-content'))
      await requestAPI<{ session: ConversationSession }>('sessions?compact=true', {
        method: 'POST', body: JSON.stringify({ id: sessionId, ...(intent.workspaceId ? { workspace_id: intent.workspaceId } : {}) }),
        ...(input.signal ? { signal: input.signal } : {})
      })
      assertSendMessageActive(profile, input.signal)
      if (model.hasChanges && model.selection) {
        await requestAPI(`sessions/${sessionId}/model`, {
          method: 'PATCH', ...(input.signal ? { signal: input.signal } : {}), body: JSON.stringify({
            provider: model.selection.provider, model: model.selection.model, ...model.selection.settings
          })
        })
      }
      assertSendMessageActive(profile, input.signal)
      await queryClient.fetchInfiniteQuery(conversationQueryOptions(profile, sessionId))
      assertSendMessageActive(profile, input.signal)
      await send.mutateAsync(input)
    },
    onSuccess: (_data, input) => {
      // Auth can change before React unmounts the previous profile's composer.
      const current = queryClient.getQueryData<{ profile_name: string | null }>(PROFILE_AUTH_QUERY_KEY)
      if (!input.signal?.aborted && current?.profile_name === profile && intent.workspaceId === workspaceId) {
        transitionToSession()
      }
    }
  })

  useEffect(() => {
    if (intent.workspaceId !== workspaceId && !create.isPending) {
      // A submitted ID stays bound to its original context, including retries
      // after uncertain delivery. Choosing another workspace starts a new intent.
      setIntent({ sessionId: createUUID(), workspaceId })
      create.reset()
      send.reset()
    }
  }, [workspaceId, intent.workspaceId, create.isPending, create.reset, send.reset])

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
        <WorkspaceSelector value={workspaceId} onChange={(id) => void navigate({ to: '/', search: id ? { workspace: id } : {}, replace: true })}
          disabled={create.isPending} />
        <QueryInput autoFocus introWave model={model} loading={create.isPending} canSubmit={!model.pending && intent.workspaceId === workspaceId}
          onSubmit={(query, attachments, onUploadProgress, signal) => create.mutateAsync(createSendMessageInput(query, attachments, create.isError ? create.variables : undefined, onUploadProgress, signal))} />
        {(create.isError || create.isPaused) && (
          <RequestFeedback error={create.error} paused={create.isPaused}
            onRetry={() => create.variables && create.mutate(create.variables)} />
        )}
      </div>
    </div>
  )
}
