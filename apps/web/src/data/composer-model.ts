import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'

import { queryClient } from '@/query-client'
import { requestAPI } from './api'
import type { ModelCatalog, ModelSelection } from './conversation'
import { conversationQueryOptions, type CachedConversation } from './conversation-queries'
import type { ModelChoice, ModelSettings, ModelProvider  } from './model-catalog'
import { useProfile } from './profile'
import type { ConversationSession } from './sessions'

export interface ComposerModelBinding {
  selection: ModelSelection | undefined
  providers: readonly ModelProvider[] | undefined
  pending: boolean
  update: (choice: ModelChoice, settings?: ModelSettings) => void
  profile: string
  hasChanges: boolean
}

/**
 * Uses profile defaults for new sessions and persisted session overrides elsewhere.
 * Changes are serialized so a rapid selection cannot be saved out of order.
 */
export function useComposerModel(sessionId?: string, currentSelection?: ModelSelection): ComposerModelBinding {
  const profile = useProfile()
  const catalog = useQuery({
    queryKey: ['models', profile],
    enabled: Boolean(profile),
    meta: { errorTitle: 'Could not load model options', profile },
    queryFn: ({ signal }) => requestAPI<ModelCatalog>('sessions/models', { signal })
  })
  const [draft, setDraft] = useState<ModelSelection>()
  const selection = draft ?? currentSelection ?? catalog.data?.selection
  const mutation = useMutation({
    meta: { errorTitle: 'Model settings were not saved', profile },
    scope: { id: `model:${profile}:${sessionId ?? 'new'}` },
    mutationFn: (next: ModelSelection) => requestAPI<{ selection: ModelSelection, session: ConversationSession }>(
      `sessions/${encodeURIComponent(sessionId ?? '')}/model`, {
        method: 'PATCH', body: JSON.stringify({ provider: next.provider, model: next.model, ...next.settings })
      }
    ),
    onSuccess: ({ selection: saved, session }) => {
      if (sessionId) {
        queryClient.setQueryData<CachedConversation>(conversationQueryOptions(profile, sessionId).queryKey, (previous) => previous ? {
          ...previous, pages: previous.pages.map((page) => ({ ...page, selection: saved, session }))
        } : previous)
      }
      setDraft((current) => current?.target === saved.target &&
        JSON.stringify(current.settings) === JSON.stringify(saved.settings) ? undefined : current)
    },
    onError: () => {
      setDraft(undefined)
    }
  })

  function update(choice: ModelChoice, settings?: ModelSettings): void {
    const target = `${choice.provider.id}/${choice.model.model}`
    const session = sessionId
      ? queryClient.getQueryData<CachedConversation>(conversationQueryOptions(profile, sessionId).queryKey)?.pages[0]?.session
      : undefined
    const profileDefaults = catalog.data?.defaults[target] ?? { reasoning: 'auto' as const, speed: 'auto' as const }
    const defaults = currentSelection?.target === target ? currentSelection.settings
      : catalog.data?.selection.target === target ? catalog.data.selection.settings
        : { ...profileDefaults, ...session?.modelSettings?.[target] }
    const next = {
      provider: choice.provider.id, model: choice.model.model, target,
      settings: settings ?? defaults
    }
    setDraft(next)
    if (sessionId) {
      mutation.mutate(next)
    }
  }

  return {
    selection,
    providers: catalog.data?.providers,
    pending: catalog.isPending || mutation.isPending,
    update,
    profile,
    hasChanges: draft !== undefined
  }
}
