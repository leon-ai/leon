import { clsx } from 'clsx'

import type { FeedToolCall } from '../../data/feed'
import { ToolCall } from '../tool-call'

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
      {toolCalls.map((toolCall) => (
        <ToolCall key={toolCall.id} toolCall={toolCall} />
      ))}
    </div>
  )
}
