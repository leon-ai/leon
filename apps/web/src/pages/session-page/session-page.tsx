import { useRef, useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { clsx } from 'clsx'

import { Feed } from '@/components/feed'
import type { FeedHandle } from '@/components/feed'
import { Button } from '@/components/button'
import { QueryInput } from '@/components/query-input'
import { createMockFeedExchange } from '@/data/feed-mocks'
import type { FeedEntry } from '@/data/feed'
import { getMockSessionInitialQuery } from '@/data/mock-session-store'

import './session-page.sass'

export function SessionPage() {
  const { sessionId } = useParams({ from: '/session/$sessionId' })
  const initialQuery = getMockSessionInitialQuery(sessionId)
  const feedRef = useRef<FeedHandle>(null)
  const [isScrollToBottomVisible, setIsScrollToBottomVisible] = useState(false)
  const [entries, setEntries] = useState<FeedEntry[]>(() => initialQuery
    ? createMockFeedExchange(initialQuery)
    : [])

  function handleSubmit(query: string): void {
    setEntries((currentEntries) => [
      ...currentEntries,
      ...createMockFeedExchange(query)
    ])
  }

  return (
    <div className="session-page">
      <Feed
        ref={feedRef}
        entries={entries}
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
            onClick={() => feedRef.current?.scrollToBottom()}
          />
        </div>
        <QueryInput autoFocus onSubmit={handleSubmit} />
      </div>
    </div>
  )
}
