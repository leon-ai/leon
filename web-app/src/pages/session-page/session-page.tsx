import { useState } from 'react'
import { useParams } from '@tanstack/react-router'

import { Feed } from '../../components/feed'
import { QueryInput } from '../../components/query-input'
import { createMockFeedExchange } from '../../data/feed-mocks'
import type { FeedEntry } from '../../data/feed'
import { getMockSessionInitialQuery } from '../../data/mock-session-store'

import './session-page.sass'

export function SessionPage() {
  const { sessionId } = useParams({ from: '/session/$sessionId' })
  const initialQuery = getMockSessionInitialQuery(sessionId)
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
      <Feed entries={entries} />
      <QueryInput autoFocus onSubmit={handleSubmit} />
    </div>
  )
}
