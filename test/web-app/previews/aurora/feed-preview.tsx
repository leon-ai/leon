import { useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { Button } from '../../../../aurora/src/v2/components/button/button'
import { ActivityDetailsProvider } from '@/components/activity-details/activity-details-provider'
import { FeedAnimationProvider } from '@/components/streaming-text'
import { LeonMessage } from '@/components/leon-message'
import { OwnerMessage } from '@/components/owner-message'
import { ConversationDetailsProvider } from '@/data/conversation-details'
import { createFeedPreviewExamples } from '../../../fixtures/feed-preview'

import './feed-preview.sass'

/**
 * Uses production feed renderers with bounded local payloads. No profile or
 * session is provided, so lazy details use those payloads rather than the API.
 */
export default function FeedPreview() {
  const [examples] = useState(() => createFeedPreviewExamples(Date.now()))
  const [selected, setSelected] = useState(examples[0]!.id)
  const [revision, setRevision] = useState(0)
  const [queryClient] = useState(() => new QueryClient())
  const example = examples.find((item) => item.id === selected)!

  useEffect(() => () => queryClient.clear(), [queryClient])

  return <section className="feed-preview" aria-label="Feed preview">
    <div className="demo-controls">
      <label>Feed example <select value={selected} onChange={(event) => setSelected(event.target.value)}>
        {(['activity', 'turn'] as const).map((kind) => <optgroup key={kind} label={kind === 'activity' ? 'Activities' : 'Complete turns'}>
          {examples.filter((item) => item.kind === kind).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </optgroup>)}
      </select></label>
      <Button onClick={() => setRevision((value) => value + 1)}>Replay example</Button>
    </div>
    <header className="feed-preview-description"><h2>{example.title}</h2><p>{example.description}</p></header>
    <QueryClientProvider client={queryClient}>
      <FeedAnimationProvider key={`${example.id}:${revision}`} live>
        <ActivityDetailsProvider entries={example.entries} sessionId={undefined}>
          <div className="feed-preview-content" role="region" aria-label="Example conversation">
            {example.entries.map((entry) => entry.role === 'owner' ? (
              <OwnerMessage key={entry.id} animationId={entry.id} timestamp={entry.sentAt}>{entry.content}</OwnerMessage>
            ) : (
              <ConversationDetailsProvider key={entry.id} sessionId={undefined} messageId={entry.id}>
                <LeonMessage entry={entry} />
              </ConversationDetailsProvider>
            ))}
          </div>
        </ActivityDetailsProvider>
      </FeedAnimationProvider>
    </QueryClientProvider>
  </section>
}
