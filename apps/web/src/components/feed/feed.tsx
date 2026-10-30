import {
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref
} from 'react'
import { observeElementOffset, useVirtualizer } from '@tanstack/react-virtual'
import { clsx } from 'clsx'

import type { FeedEntry } from '@/data/feed'
import { LeonMessage } from '@/components/leon-message'
import { Message } from '@/components/message'
import { OwnerMessage } from '@/components/owner-message'
import { FeedAnimationProvider } from '@/components/streaming-text'
import { ConversationDetailsProvider } from '@/data/conversation-details'

import './feed.sass'

const FEED_TURN_ESTIMATED_HEIGHT = 608
const FEED_OVERSCAN_COUNT = 1
const OWNER_MESSAGE_REVEAL_SCROLL_PROGRESS = .33
const REDUCED_MOTION_MEDIA_QUERY = '(prefers-reduced-motion: reduce)'
const SCROLL_POSITION_TOLERANCE_PX = 1
const SCROLL_SETTLE_DELAY_MS = 100
const SCROLL_TO_BOTTOM_THRESHOLD_PX = 64

/**
 * Exposes feed navigation without duplicating its virtualized scroll lifecycle.
 */
export interface FeedHandle {
  scrollToBottom: () => void
}

interface FeedProps {
  entries: FeedEntry[]
  onScrollToBottomVisibilityChange?: (visible: boolean) => void
  ref?: Ref<FeedHandle>
  historicalIds?: readonly string[]
  sessionId?: string
  onLoadEarlier?: () => void
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

export function Feed({
  entries,
  onScrollToBottomVisibilityChange,
  ref,
  historicalIds,
  sessionId,
  onLoadEarlier
}: FeedProps) {
  const feedRef = useRef<HTMLElement>(null)
  const bottomMaskRef = useRef<HTMLDivElement>(null)
  const previousTurnCountRef = useRef<number | null>(null)
  const previousFirstTurnRef = useRef<string | undefined>(undefined)
  const scrimRef = useRef<HTMLDivElement>(null)
  const topMaskRef = useRef<HTMLDivElement>(null)
  const scrollToBottomVisibleRef = useRef(false)
  const [isScrollToBottomVisible, setIsScrollToBottomVisible] = useState(false)
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
    overscan: FEED_OVERSCAN_COUNT,
    // TanStack preserves visible keys when history is prepended and tracks
    // dynamic response growth without competing custom scroll observers.
    anchorTo: 'end',
    useAnimationFrameWithResizeObserver: true,
    observeElementOffset: (instance, onOffsetChange) =>
      observeElementOffset(instance, (offset, isScrolling) => {
        onOffsetChange(offset, isScrolling)
        if (isScrolling && instance.scrollDirection === 'backward' && offset < FEED_TURN_ESTIMATED_HEIGHT) {
          onLoadEarlier?.()
        }

        // Reuse the virtualizer's observer; only visibility changes enter React.
        // Once revealed, keep the control available until the owner reaches the end.
        const visible = instance.options.count > 0 &&
          !instance.isAtEnd(SCROLL_TO_BOTTOM_THRESHOLD_PX) &&
          (scrollToBottomVisibleRef.current ||
            (isScrolling && instance.scrollDirection === 'backward'))

        if (visible !== scrollToBottomVisibleRef.current) {
          scrollToBottomVisibleRef.current = visible
          setIsScrollToBottomVisible(visible)
        }
      })
  })

  useImperativeHandle(ref, () => ({
    scrollToBottom: () => {
      virtualizer.scrollToEnd({
        behavior: window.matchMedia(REDUCED_MOTION_MEDIA_QUERY).matches
          ? 'auto'
          : 'smooth'
      })
    }
  }), [virtualizer])

  useLayoutEffect(() => {
    // Disclosure resizing can reach the end without emitting a scroll event.
    if (
      scrollToBottomVisibleRef.current &&
      (previousTurnCountRef.current !== turnCount ||
        virtualizer.isAtEnd(SCROLL_TO_BOTTOM_THRESHOLD_PX))
    ) {
      scrollToBottomVisibleRef.current = false
      setIsScrollToBottomVisible(false)
    }
  })

  useLayoutEffect(() => {
    onScrollToBottomVisibilityChange?.(isScrollToBottomVisible)
  }, [isScrollToBottomVisible, onScrollToBottomVisibilityChange])

  useLayoutEffect(() => {
    const feed = feedRef.current
    const bottomMask = bottomMaskRef.current
    const scrollElement = feed?.closest<HTMLElement>('.app-main')
    const scrim = scrimRef.current
    const topMask = topMaskRef.current

    if (
      feed === null ||
      bottomMask === null ||
      scrollElement === undefined ||
      scrollElement === null ||
      scrim === null ||
      topMask === null
    ) {
      return undefined
    }

    const observedFeed = feed
    const observedLayers = [bottomMask, topMask, scrim]
    const observedScrollElement = scrollElement

    // Fixed elements use the viewport as their containing block, so measure
    // the feed to account for the main scrollbar and sidebar transitions.
    function updateLayerBounds(): void {
      const feedBounds = observedFeed.getBoundingClientRect()

      for (const layer of observedLayers) {
        layer.style.left = `${feedBounds.left}px`
        layer.style.width = `${feedBounds.width}px`
      }
    }

    const resizeObserver = new ResizeObserver(updateLayerBounds)
    resizeObserver.observe(observedFeed)
    resizeObserver.observe(observedScrollElement)
    updateLayerBounds()

    return () => resizeObserver.disconnect()
  }, [])

  useLayoutEffect(() => {
    const previousTurnCount = previousTurnCountRef.current
    const previousFirstTurn = previousFirstTurnRef.current
    previousFirstTurnRef.current = turns[0]?.id

    if (previousFirstTurn && previousFirstTurn !== turns[0]?.id) {
      const previousFirstIndex = turns.findIndex((turn) => turn.id === previousFirstTurn)
      if (previousFirstIndex > 0) {
        previousTurnCountRef.current = turnCount
        // Preserve the visible anchor when older history is prepended.
        return
      }
    }

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
      virtualizer.scrollToIndex(latestTurnIndex, { align: 'end', behavior: 'auto' })
      return
    }

    // Each turn owns its reveal scroll; an older virtualizer target must not
    // keep correcting the viewport after a new turn takes over.
    virtualizer.cancelScroll()

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

      // Reveal the owner message at its position inside the turn instead of
      // aligning the virtualized turn's outer bounds.
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
    <FeedAnimationProvider live={Boolean(sessionId)} {...(historicalIds ? { historicalIds } : {})}>
      <section ref={feedRef} className="feed" aria-label="Session messages">
        <div
          ref={scrimRef}
          className="feed-scrim"
          hidden={entries.length === 0}
          aria-hidden="true"
        />
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
                        <ConversationDetailsProvider sessionId={sessionId} messageId={entry.id}>
                          <LeonMessage entry={entry} />
                        </ConversationDetailsProvider>
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
