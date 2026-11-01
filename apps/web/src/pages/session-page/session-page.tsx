import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useParams } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { clsx } from 'clsx'

import { Feed } from '@/components/feed'
import type { FeedHandle } from '@/components/feed'
import { Button } from '@/components/button'
import { QueryInput } from '@/components/query-input'
import { useConversation, useSendMessage } from '@/data/conversation-queries'
import { useComposerModel } from '@/data/composer-model'
import { requestAPI } from '@/data/api'
import { useProfile } from '@/data/profile'
import { RequestFeedback } from '@/components/request-feedback/request-feedback'

import './session-page.sass'

const CONVERSATION_LOADING_DELAY_MS = 1_000

export function SessionPage() {
  const { sessionId } = useParams({ from: '/session/$sessionId' })
  // A history key also identifies selecting the already-active session.
  const navigationKey = useLocation({ select: (location) => location.state['__TSR_key'] }) ?? sessionId

  return <SessionContent key={sessionId} sessionId={sessionId} navigationKey={navigationKey} />
}

function SessionContent({ sessionId, navigationKey }: { sessionId: string, navigationKey: string }) {
  const conversation = useConversation(sessionId)
  const send = useSendMessage(sessionId)
  const model = useComposerModel(sessionId, conversation.latest?.selection)
  const profile = useProfile()
  const stop = useMutation({
    meta: { errorTitle: 'Could not stop this turn', profile },
    // Stopping must attempt immediately rather than wait for an online signal.
    networkMode: 'always',
    mutationFn: () => requestAPI(`sessions/${encodeURIComponent(sessionId)}/stop`, { method: 'POST' })
  })
  const feedRef = useRef<FeedHandle>(null)
  const [isScrollToBottomVisible, setIsScrollToBottomVisible] = useState(false)
  const [composerFocusRequest, setComposerFocusRequest] = useState(0)
  const [showLoading, setShowLoading] = useState(false)
  const isInitialLoading = conversation.isPending && conversation.fetchStatus === 'fetching'

  useEffect(() => {
    if (!isInitialLoading) {
      setShowLoading(false)
      return undefined
    }

    // Cached and fast session switches should not flash a loading notice.
    const timer = window.setTimeout(() => setShowLoading(true), CONVERSATION_LOADING_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [isInitialLoading])

  function handleSubmit(query: string): void {
    send.mutate({ id: crypto.randomUUID(), query })
  }

  function handleReturnToLatest(): void {
    // The query cache reports failures, including after this page unmounts.
    void conversation.returnToLatest().catch(() => undefined)
  }

  const loadEarlier = useCallback((): void => {
    if (conversation.hasNextPage && !conversation.isFetching && !conversation.isFetchNextPageError) {
      // Scroll and layout notifications can coincide before React rerenders.
      // Query keeps one page request alive rather than cancelling and restarting it.
      void conversation.fetchNextPage({ cancelRefetch: false })
    }
  }, [conversation.hasNextPage, conversation.isFetching, conversation.isFetchNextPageError, conversation.fetchNextPage])

  return (
    <div className="session-page">
      {isInitialLoading && showLoading && (
        <RequestFeedback role="status" message="Loading conversation…" />
      )}
      {!conversation.latest && (conversation.isError || conversation.fetchStatus === 'paused') && (
        <RequestFeedback
          error={conversation.error}
          paused={conversation.fetchStatus === 'paused'}
          retrying={conversation.isFetching}
          onRetry={() => void conversation.refetch()}
        />
      )}
      {conversation.latest?.command?.status === 'interrupted' && (
        <p role="status">This turn was interrupted by a server restart. Your saved work is available below.</p>
      )}
      {send.isError && (
        <Button onClick={() => send.variables && send.mutate(send.variables)}>Retry sending message</Button>
      )}
      <Feed
        key={navigationKey}
        ref={feedRef}
        entries={conversation.entries}
        historicalIds={conversation.historicalIds}
        sessionId={sessionId}
        history={{
          canLoad: Boolean(conversation.hasNextPage),
          isLoading: conversation.isFetchingNextPage,
          isError: conversation.isFetchNextPageError,
          onLoad: loadEarlier,
          onRetry: () => void conversation.fetchNextPage({ cancelRefetch: false })
        }}
        onScrollToBottomVisibilityChange={setIsScrollToBottomVisible}
      />
      <div className="session-page-composer">
        <div
          className={clsx('session-page-scroll-to-bottom', {
            'session-page-scroll-to-bottom-visible': isScrollToBottomVisible
          })}
          aria-hidden={!isScrollToBottomVisible}
          inert={!isScrollToBottomVisible}
        >
          <Button
            ariaLabel="Scroll to bottom"
            iconName="arrow-down"
            variant="secondary"
            onClick={() => {
              if (conversation.hasPreviousPage) {
                handleReturnToLatest()
              } else {
                feedRef.current?.scrollToBottom()
              }

              // Reuse silent autofocus without interrupting the feed's scrolling.
              setComposerFocusRequest((request) => request + 1)
            }}
          />
        </div>
        <QueryInput
          sessionId={sessionId}
          autoFocus
          autoFocusKey={`${navigationKey}:${composerFocusRequest}`}
          model={model}
          canSubmit={Boolean(conversation.latest && !model.pending)}
          onSubmit={handleSubmit}
          {...(conversation.latest?.is_running ? {
            onStop: () => {
              stop.mutate()
            }
          } : {})}
        />
      </div>
    </div>
  )
}
