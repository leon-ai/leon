import { clsx } from 'clsx'

import type { FeedToolCall } from '@/data/feed'
import { isToolCallVisible } from '@/data/feed'
import { ToolCall } from '@/components/tool-call'

import './tool-call-list.sass'

interface ToolCallListProps {
  nested?: boolean
  toolCalls: FeedToolCall[]
}

export function ToolCallList({
  nested = false,
  toolCalls
}: ToolCallListProps) {
  return (
    <div className={clsx('tool-call-list', {
      'tool-call-list-nested': nested
    })}>
      {toolCalls.filter(isToolCallVisible).map((toolCall) => (
        <ToolCall key={toolCall.id} toolCall={toolCall} />
      ))}
    </div>
  )
}
