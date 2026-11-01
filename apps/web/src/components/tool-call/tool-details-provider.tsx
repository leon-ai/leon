import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

import { ConversationDetailsProvider, ConversationDetailsContext } from '@/data/conversation-details'
import type { FeedEntry, FeedToolCall, LeonFeedActivity } from '@/data/feed'
import { ToolDetailsDialog } from './tool-details-dialog'

interface ToolSelection {
  toolCall: FeedToolCall
  technicalTitle: string
  messageId: string
  opener: HTMLElement | null
}

const ToolDetailsContext = createContext<((selection: ToolSelection) => void) | null>(null)

function findTool(activities: LeonFeedActivity[], id: string): FeedToolCall | undefined {
  for (const activity of activities) {
    if (activity.type === 'tools') {
      const tool = activity.toolCalls.find((call) => call.id === id)
      if (tool) {
        return tool
      }
    } else if (activity.type === 'plan') {
      for (const step of activity.steps) {
        const tool = step.toolCalls.find((call) => call.id === id) ?? findTool(step.activities ?? [], id)
        if (tool) {
          return tool
        }
      }
    }
  }

  return undefined
}

/**
 * Keeps an inspector alive outside virtualized rows and collapsing turn details.
 */
export function ToolDetailsProvider({ entries, sessionId, children }: {
  entries: FeedEntry[]
  sessionId: string | undefined
  children: ReactNode
}) {
  const [selection, setSelection] = useState<ToolSelection | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const open = useCallback((next: ToolSelection): void => {
    setSelection(next)
    setIsOpen(true)
  }, [])
  let tool = selection?.toolCall
  if (selection) {
    for (const entry of entries) {
      if (entry.role === 'leon' && (entry.responseId ?? entry.id) === selection.messageId) {
        tool = findTool(entry.activities, selection.toolCall.id) ?? tool
      }
    }
  }

  return (
    <ToolDetailsContext value={open}>
      {children}
      {selection && tool && (
        <ConversationDetailsProvider sessionId={sessionId} messageId={selection.messageId}>
          <ToolDetailsDialog open={isOpen} toolCall={tool} technicalTitle={selection.technicalTitle}
            onClose={() => setIsOpen(false)} onAfterClose={() => {
              setSelection(null)
              selection.opener?.focus({ preventScroll: true })
            }} />
        </ConversationDetailsProvider>
      )}
    </ToolDetailsContext>
  )
}

/**
 * Opens the feed-owned inspector with the invocation's existing response identity.
 */
export function useOpenToolDetails(toolCall: FeedToolCall, technicalTitle: string): () => void {
  const open = useContext(ToolDetailsContext)
  const response = useContext(ConversationDetailsContext)

  return () => open?.({ toolCall, technicalTitle, messageId: response?.messageId ?? '',
    opener: document.activeElement instanceof HTMLElement ? document.activeElement : null })
}
