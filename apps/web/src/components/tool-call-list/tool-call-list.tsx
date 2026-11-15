import { clsx } from 'clsx'
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react'
import { observeElementOffset, useVirtualizer } from '@tanstack/react-virtual'

import type { FeedToolCall } from '@/data/feed'
import { isToolCallVisible } from '@/data/feed'
import { ToolCall } from '@/components/tool-call'

import './tool-call-list.sass'

const VIRTUAL_TOOL_CALL_THRESHOLD = 40
const TOOL_CALL_ESTIMATED_HEIGHT_PX = 22

// A new virtual range should mount only incoming calls, leaving retained
// disclosures and their query observers untouched.
const VirtualToolCall = memo(function VirtualToolCall({ toolCall, index, offset, measureRef }: {
  toolCall: FeedToolCall
  index: number
  offset: number
  measureRef: Ref<HTMLElement>
}) {
  return <ToolCall toolCall={toolCall} rowIndex={index} measureRef={measureRef}
    style={{ position: 'absolute', width: '100%', top: 0, left: 0,
      transform: `translateY(${offset}px)` }} />
})

function VirtualToolCalls({ toolCalls }: { toolCalls: FeedToolCall[] }) {
  const listRef = useRef<HTMLDivElement>(null)
  const [gap, setGap] = useState(0)
  const [scrollMargin, setScrollMargin] = useState(0)
  const getToolKey = useCallback((index: number) => toolCalls[index]!.id, [toolCalls])
  const virtualizer = useVirtualizer({
    count: toolCalls.length,
    getScrollElement: () => listRef.current?.closest<HTMLElement>('.app-main') ?? null,
    estimateSize: () => TOOL_CALL_ESTIMATED_HEIGHT_PX,
    getItemKey: getToolKey,
    gap, scrollMargin,
    overscan: 5,
    // Only the feed may reposition the shared scroller. Seed this observer
    // from its current offset when a disclosure mounts midway through history.
    scrollToFn: () => undefined,
    observeElementOffset: (instance, onOffsetChange) => {
      onOffsetChange(instance.scrollElement?.scrollTop ?? 0, false)

      return observeElementOffset(instance, onOffsetChange)
    }
  })
  // The turn virtualizer owns anchoring for the shared conversation viewport.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false

  useLayoutEffect(() => {
    const list = listRef.current
    const scroller = virtualizer.scrollElement
    if (!list || !scroller) {
      return
    }

    const observedList = list
    const observedScroller = scroller

    function updateLayout(): void {
      const nextGap = Number.parseFloat(getComputedStyle(observedList).getPropertyValue('--activity-node-gap')) || 0
      const nextMargin = observedList.getBoundingClientRect().top - observedScroller.getBoundingClientRect().top +
        observedScroller.scrollTop - observedScroller.clientTop

      setGap(nextGap)
      setScrollMargin(nextMargin)
    }

    updateLayout()
    // Parent turns can move this list as streamed content and disclosures grow.
    // Observe geometry changes rather than measuring after each scroll render.
    const observer = new ResizeObserver(updateLayout)
    observer.observe(list)
    observer.observe(scroller)
    const feed = list.closest('.feed')
    if (feed) {
      observer.observe(feed)
    }

    return () => observer.disconnect()
  }, [virtualizer])

  return (
    <div ref={listRef} className="tool-call-list tool-call-list-virtual activity-timeline"
      role="region" aria-label="Tool calls" style={{ height: `${virtualizer.getTotalSize()}px` }}>
      {virtualizer.getVirtualItems().map((row) => (
        <VirtualToolCall key={row.key} toolCall={toolCalls[row.index]!} index={row.index}
          measureRef={virtualizer.measureElement}
          offset={row.start - scrollMargin} />
      ))}
    </div>
  )
}

interface ToolCallListProps {
  nested?: boolean
  toolCalls: FeedToolCall[]
}

export function ToolCallList({
  nested = false,
  toolCalls
}: ToolCallListProps) {
  const visibleCalls = useMemo(() => toolCalls.filter(isToolCallVisible), [toolCalls])
  if (visibleCalls.length > VIRTUAL_TOOL_CALL_THRESHOLD) {
    return <VirtualToolCalls toolCalls={visibleCalls} />
  }

  return (
    <div className={clsx('tool-call-list activity-timeline', {
      'tool-call-list-nested': nested
    })}>
      {visibleCalls.map((toolCall) => (
        <ToolCall key={toolCall.id} toolCall={toolCall} />
      ))}
    </div>
  )
}
