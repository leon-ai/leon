import { useLayoutEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { clsx } from 'clsx'

import type { FeedEntry } from '../../data/feed'
import { LeonMessage } from '../leon-message'
import { Message } from '../message'
import { OwnerMessage } from '../owner-message'
import { FeedAnimationProvider } from '../streaming-text'

import './feed.sass'

const FEED_TURN_ESTIMATED_HEIGHT = 608
const FEED_OVERSCAN_COUNT = 4
const OWNER_MESSAGE_REVEAL_SCROLL_PROGRESS = .33
const REDUCED_MOTION_MEDIA_QUERY = '(prefers-reduced-motion: reduce)'
const SCROLL_POSITION_TOLERANCE_PX = 1
const SCROLL_SETTLE_DELAY_MS = 100

interface FeedProps {
  entries: FeedEntry[]
}

interface FeedTurn {
  entries: FeedEntry[]
  id: string
}

function groupEntriesByTurn(entries: FeedEntry[]): FeedTurn[] {
  const turns: FeedTurn[] = []

  for (const entry of entries) {
    const currentTurn = turns.at(-1)

    if (entry.role === 'owner' || currentTurn === undefined) {
      turns.push({
        id: entry.id,
        entries: [entry]
      })
      continue
    }

    currentTurn.entries.push(entry)
  }

  return turns
}

function supportsScrollEnd(element: HTMLElement): boolean {
  return 'onscrollend' in element
}

export function Feed({ entries }: FeedProps) {
  const feedRef = useRef<HTMLElement>(null)
  const bottomMaskRef = useRef<HTMLDivElement>(null)
  const previousTurnCountRef = useRef<number | null>(null)
  const topMaskRef = useRef<HTMLDivElement>(null)
  const turns = useMemo(() => groupEntriesByTurn(entries), [entries])
  const turnCount = turns.length
  const virtualizer = useVirtualizer({
    count: turnCount,
    // The page owns vertical scrolling so its scrollbar remains at the
    // viewport edge instead of being constrained to the content column.
    getScrollElement: () =>
      feedRef.current?.closest<HTMLElement>('.app-main') ?? null,
    getItemKey: (index) => turns[index]?.id ?? index,
    estimateSize: () => FEED_TURN_ESTIMATED_HEIGHT,
    overscan: FEED_OVERSCAN_COUNT
  })

  useLayoutEffect(() => {
    const feed = feedRef.current
    const bottomMask = bottomMaskRef.current
    const scrollElement = feed?.closest<HTMLElement>('.app-main')
    const topMask = topMaskRef.current

    if (
      feed === null ||
      bottomMask === null ||
      scrollElement === undefined ||
      scrollElement === null ||
      topMask === null
    ) {
      return undefined
    }

    const observedFeed = feed
    const observedMasks = [bottomMask, topMask]
    const observedScrollElement = scrollElement

    // Fixed elements use the viewport as their containing block, so measure
    // the feed to account for the main scrollbar and sidebar transitions.
    function updateMaskBounds(): void {
      const feedBounds = observedFeed.getBoundingClientRect()

      for (const mask of observedMasks) {
        mask.style.left = `${feedBounds.left}px`
        mask.style.width = `${feedBounds.width}px`
      }
    }

    const resizeObserver = new ResizeObserver(updateMaskBounds)
    resizeObserver.observe(observedFeed)
    resizeObserver.observe(observedScrollElement)
    updateMaskBounds()

    return () => resizeObserver.disconnect()
  }, [])

  useLayoutEffect(() => {
    const previousTurnCount = previousTurnCountRef.current

    if (turnCount === 0) {
      previousTurnCountRef.current = 0
      return
    }

    if (previousTurnCount === turnCount) {
      return
    }

    const isInitialPosition = previousTurnCount === null
    const latestTurnIndex = turnCount - 1
    previousTurnCountRef.current = turnCount

    if (isInitialPosition) {
      virtualizer.scrollToIndex(latestTurnIndex, {
        align: 'end',
        behavior: 'auto'
      })
      return
    }

    const feedElement = feedRef.current
    const scrollElement = feedElement?.closest<HTMLElement>('.app-main')
    const previousTurnElement = feedElement?.querySelector<HTMLElement>(
      `[data-index="${latestTurnIndex - 1}"]`
    )
    const latestTurnElement = feedElement?.querySelector<HTMLElement>(
      `[data-index="${latestTurnIndex}"]`
    )

    if (
      feedElement === null ||
      scrollElement === undefined ||
      scrollElement === null ||
      latestTurnElement === undefined ||
      latestTurnElement === null
    ) {
      return
    }

    const observedLatestTurnElement = latestTurnElement
    const observedScrollElement = scrollElement
    const hasScrollEndSupport = supportsScrollEnd(observedScrollElement)

    // The former latest turn just lost its viewport minimum. Refresh that
    // measurement before deriving the new turn's final scroll destination.
    if (previousTurnElement !== undefined && previousTurnElement !== null) {
      virtualizer.resizeItem(
        latestTurnIndex - 1,
        previousTurnElement.getBoundingClientRect().height
      )
    }

    virtualizer.resizeItem(
      latestTurnIndex,
      observedLatestTurnElement.getBoundingClientRect().height
    )

    // Pausing the existing entrance animation keeps the owner message at its
    // initial invisible frame while still reserving its full layout space.
    observedLatestTurnElement.classList.add('feed-turn-awaiting-owner')

    let ownerMessageRevealed = false
    let scrollStartOffset = observedScrollElement.scrollTop
    let scrollTargetOffset = scrollStartOffset
    let scrollSettleTimeout: number | undefined

    function revealOwnerMessage(): void {
      if (ownerMessageRevealed) {
        return
      }

      ownerMessageRevealed = true
      observedLatestTurnElement.classList.remove('feed-turn-awaiting-owner')
      observedScrollElement.removeEventListener('scroll', handleScroll)
      observedScrollElement.removeEventListener('scrollend', revealOwnerMessage)

      if (scrollSettleTimeout !== undefined) {
        window.clearTimeout(scrollSettleTimeout)
      }
    }

    function handleScroll(): void {
      const totalDistance = Math.abs(scrollTargetOffset - scrollStartOffset)
      const travelledDistance = Math.abs(
        observedScrollElement.scrollTop - scrollStartOffset
      )

      if (
        totalDistance <= SCROLL_POSITION_TOLERANCE_PX ||
        travelledDistance / totalDistance >=
          OWNER_MESSAGE_REVEAL_SCROLL_PROGRESS
      ) {
        revealOwnerMessage()
        return
      }

      if (!hasScrollEndSupport) {
        if (scrollSettleTimeout !== undefined) {
          window.clearTimeout(scrollSettleTimeout)
        }

        scrollSettleTimeout = window.setTimeout(
          revealOwnerMessage,
          SCROLL_SETTLE_DELAY_MS
        )
      }
    }

    const animationFrame = window.requestAnimationFrame(() => {
      const feedTopClearance = Number.parseFloat(
        window.getComputedStyle(feedElement).paddingTop
      )
      const targetOffset = scrollElement.scrollTop +
        observedLatestTurnElement.getBoundingClientRect().top -
        feedTopClearance
      const shouldReduceMotion = window.matchMedia(
        REDUCED_MOTION_MEDIA_QUERY
      ).matches

      if (
        shouldReduceMotion ||
        Math.abs(targetOffset - scrollElement.scrollTop) <=
          SCROLL_POSITION_TOLERANCE_PX
      ) {
        scrollElement.scrollTo({ top: targetOffset, behavior: 'auto' })
        revealOwnerMessage()
        return
      }

      scrollStartOffset = observedScrollElement.scrollTop
      scrollTargetOffset = targetOffset
      observedScrollElement.addEventListener('scroll', handleScroll, {
        passive: true
      })

      if (hasScrollEndSupport) {
        observedScrollElement.addEventListener('scrollend', revealOwnerMessage, {
          once: true
        })
      }

      // Native scrolling avoids TanStack's dynamic-size reconciliation
      // replacing this movement with an immediate corrective scroll.
      scrollElement.scrollTo({
        top: targetOffset,
        behavior: 'smooth'
      })
    })

    return () => {
      window.cancelAnimationFrame(animationFrame)
      observedScrollElement.removeEventListener('scrollend', revealOwnerMessage)
      observedScrollElement.removeEventListener('scroll', handleScroll)
      revealOwnerMessage()

      if (scrollSettleTimeout !== undefined) {
        window.clearTimeout(scrollSettleTimeout)
      }
    }
  }, [turnCount, virtualizer])

  return (
    <FeedAnimationProvider>
      <section ref={feedRef} className="feed" aria-label="Session messages">
        <div
          className="feed-virtual-content"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const turn = turns[virtualItem.index]

            if (turn === undefined) {
              return null
            }

            const isLatestTurn = virtualItem.index === turnCount - 1

            return (
              <div
                key={turn.id}
                ref={virtualizer.measureElement}
                className={clsx('feed-turn', {
                  'feed-turn-latest': isLatestTurn
                })}
                data-index={virtualItem.index}
                style={{ transform: `translateY(${virtualItem.start}px)` }}
              >
                {turn.entries.map((entry) => (
                  <div key={entry.id} className="feed-entry">
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
                ))}
              </div>
            )
          })}
        </div>
        <div
          ref={topMaskRef}
          className="feed-mask feed-mask-top"
          aria-hidden="true"
        />
        <div
          ref={bottomMaskRef}
          className="feed-mask feed-mask-bottom"
          aria-hidden="true"
        />
      </section>
    </FeedAnimationProvider>
  )
}
