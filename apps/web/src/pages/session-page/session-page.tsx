import { useRef, useState } from 'react'
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

import './session-page.sass'

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
    meta: { errorTitle: 'Could not stop this session', profile },
    // Stopping must attempt immediately rather than wait for an online signal.
    networkMode: 'always',
    mutationFn: () => requestAPI(`sessions/${encodeURIComponent(sessionId)}/stop`, { method: 'POST' })
  })
  const feedRef = useRef<FeedHandle>(null)
  const [isScrollToBottomVisible, setIsScrollToBottomVisible] = useState(false)
  const [composerFocusRequest, setComposerFocusRequest] = useState(0)

  function handleSubmit(query: string): void {
    send.mutate({ id: crypto.randomUUID(), query })
  }

  function handleReturnToLatest(): void {
    // The query cache reports failures, including after this page unmounts.
    void conversation.returnToLatest().catch(() => undefined)
  }

  return (
    <div className="session-page">
      {conversation.isPending && <p role="status">Loading conversation…</p>}
      {conversation.isError && (
        <div role="alert">
          <p>{conversation.error.message}</p>
          <Button onClick={() => void conversation.refetch()}>Retry</Button>
        </div>
      )}
      {conversation.hasNextPage && (
        <Button disabled={conversation.isFetchingNextPage} onClick={() => void conversation.fetchNextPage()}>
          Load earlier messages
        </Button>
      )}
      {conversation.hasPreviousPage && (
        <Button onClick={handleReturnToLatest}>Back to latest messages</Button>
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
        onLoadEarlier={() => {
          if (conversation.hasNextPage && !conversation.isFetching) {
            void conversation.fetchNextPage()
          }
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
