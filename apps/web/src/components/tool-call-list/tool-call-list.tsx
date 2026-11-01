import { clsx } from 'clsx'
import { useLayoutEffect, useRef, useState } from 'react'
import { observeElementOffset, useVirtualizer } from '@tanstack/react-virtual'

import type { FeedToolCall } from '@/data/feed'
import { isToolCallVisible } from '@/data/feed'
import { ToolCall } from '@/components/tool-call'

import './tool-call-list.sass'

const VIRTUAL_TOOL_CALL_THRESHOLD = 40
const TOOL_CALL_ESTIMATED_HEIGHT_PX = 22

function VirtualToolCalls({ toolCalls }: { toolCalls: FeedToolCall[] }) {
  const listRef = useRef<HTMLDivElement>(null)
  const [gap, setGap] = useState(0)
  const [scrollMargin, setScrollMargin] = useState(0)
  const virtualizer = useVirtualizer({
    count: toolCalls.length,
    getScrollElement: () => listRef.current?.closest<HTMLElement>('.app-main') ?? null,
    estimateSize: () => TOOL_CALL_ESTIMATED_HEIGHT_PX,
    getItemKey: (index) => toolCalls[index]!.id,
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
    if (list && scroller) {
      setGap(Number.parseFloat(getComputedStyle(list).getPropertyValue('--activity-node-gap')) || 0)
      setScrollMargin(list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - scroller.clientTop)
    }
  })

  return (
    <div ref={listRef} className="tool-call-list tool-call-list-virtual activity-timeline"
      role="region" aria-label="Tool calls" style={{ height: `${virtualizer.getTotalSize()}px` }}>
      {virtualizer.getVirtualItems().map((row) => (
        <ToolCall key={row.key} toolCall={toolCalls[row.index]!} rowIndex={row.index}
          measureRef={virtualizer.measureElement}
          style={{ position: 'absolute', width: '100%', top: 0, left: 0,
            transform: `translateY(${row.start - scrollMargin}px)` }} />
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
  const visibleCalls = toolCalls.filter(isToolCallVisible)
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
