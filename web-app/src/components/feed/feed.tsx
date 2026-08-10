import { useEffect, useLayoutEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { clsx } from 'clsx'

import type { FeedEntry } from '../../data/feed'
import { LeonMessage } from '../leon-message'
import { Message } from '../message'
import { OwnerMessage } from '../owner-message'
import { FeedAnimationProvider } from '../streaming-text'

import './feed.sass'

const OWNER_MESSAGE_ESTIMATED_HEIGHT = 88
const LEON_MESSAGE_ESTIMATED_HEIGHT = 520
const FEED_OVERSCAN_COUNT = 4

interface FeedProps {
  entries: FeedEntry[]
}

export function Feed({ entries }: FeedProps) {
  const feedRef = useRef<HTMLElement>(null)
  const maskRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: entries.length,
    // The page owns vertical scrolling so its scrollbar remains at the
    // viewport edge instead of being constrained to the content column.
    getScrollElement: () =>
      feedRef.current?.closest<HTMLElement>('.app-main') ?? null,
    getItemKey: (index) => entries[index]?.id ?? index,
    estimateSize: (index) => entries[index]?.role === 'owner'
      ? OWNER_MESSAGE_ESTIMATED_HEIGHT
      : LEON_MESSAGE_ESTIMATED_HEIGHT,
    overscan: FEED_OVERSCAN_COUNT
  })

  useLayoutEffect(() => {
    const feed = feedRef.current
    const mask = maskRef.current
    const scrollElement = feed?.closest<HTMLElement>('.app-main')

    if (
      feed === null ||
      mask === null ||
      scrollElement === undefined ||
      scrollElement === null
    ) {
      return undefined
    }

    const observedFeed = feed
    const observedMask = mask
    const observedScrollElement = scrollElement

    // Fixed elements use the viewport as their containing block, so measure
    // the feed to account for the main scrollbar and sidebar transitions.
    function updateMaskBounds(): void {
      const feedBounds = observedFeed.getBoundingClientRect()

      observedMask.style.left = `${feedBounds.left}px`
      observedMask.style.width = `${feedBounds.width}px`
    }

    const resizeObserver = new ResizeObserver(updateMaskBounds)
    resizeObserver.observe(observedFeed)
    resizeObserver.observe(observedScrollElement)
    updateMaskBounds()

    return () => resizeObserver.disconnect()
  }, [])

  useEffect(() => {
    if (entries.length === 0) {
      return
    }

    const animationFrame = window.requestAnimationFrame(() => {
      virtualizer.scrollToIndex(entries.length - 1, { align: 'end' })
    })

    return () => window.cancelAnimationFrame(animationFrame)
  }, [entries.length, virtualizer])

  return (
    <FeedAnimationProvider>
      <section ref={feedRef} className="feed" aria-label="Session messages">
        <div
          className="feed-virtual-content"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const entry = entries[virtualItem.index]

            if (entry === undefined) {
              return null
            }

            const previousEntry = entries[virtualItem.index - 1]
            const startsNewTurn = entry.role === 'owner' &&
              previousEntry?.role === 'leon'
            const isLastLeonEntry = entry.role === 'leon' &&
              virtualItem.index === entries.length - 1

            return (
              <div
                key={entry.id}
                ref={virtualizer.measureElement}
                className={clsx('feed-entry', {
                  'feed-entry-turn-start': startsNewTurn,
                  'feed-entry-last-leon': isLastLeonEntry
                })}
                data-index={virtualItem.index}
                style={{ transform: `translateY(${virtualItem.start}px)` }}
              >
                <Message role={entry.role}>
                  {entry.role === 'owner' ? (
                    <OwnerMessage animationId={`${entry.id}:owner`}>
                      {entry.content}
                    </OwnerMessage>
                  ) : (
                    <LeonMessage entry={entry} />
                  )}
                </Message>
              </div>
            )
          })}
        </div>
        <div ref={maskRef} className="feed-mask" aria-hidden="true" />
      </section>
    </FeedAnimationProvider>
  )
}
