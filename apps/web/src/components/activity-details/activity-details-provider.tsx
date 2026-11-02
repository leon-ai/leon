import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

import { ConversationDetailsProvider, ConversationDetailsContext } from '@/data/conversation-details'
import type { FeedEntry, FeedToolCall, LeonFeedActivity } from '@/data/feed'
import type { AgentSkillSnapshot } from '../../../../../server/src/core/llm-manager/agent-progress-contract'
import { CodeView } from '@/components/code-view'
import { ToolDetailsDialog } from '@/components/tool-call/tool-details-dialog'
import { ActivityDetailsDialog } from './activity-details-dialog'

enum ActivityDetailsKind {
  Tool = 'tool',
  Text = 'text'
}

interface ToolSelection {
  kind: ActivityDetailsKind.Tool
  toolCall: FeedToolCall
  technicalTitle: string
  messageId: string
  opener: HTMLElement | null
}

interface TextSelection {
  kind: ActivityDetailsKind.Text
  title: string
  path: string
  content: string
  contentName: string
  language: string
  opener: HTMLElement | null
}

type ActivitySelection = ToolSelection | TextSelection

const ActivityDetailsContext = createContext<((selection: ActivitySelection) => void) | null>(null)

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
export function ActivityDetailsProvider({ entries, sessionId, children }: {
  entries: FeedEntry[]
  sessionId: string | undefined
  children: ReactNode
}) {
  const [selection, setSelection] = useState<ActivitySelection | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const open = useCallback((next: ActivitySelection): void => {
    setSelection(next)
    setIsOpen(true)
  }, [])
  let tool = selection?.kind === ActivityDetailsKind.Tool ? selection.toolCall : undefined
  if (selection?.kind === ActivityDetailsKind.Tool) {
    for (const entry of entries) {
      if (entry.role === 'leon' && (entry.responseId ?? entry.id) === selection.messageId) {
        tool = findTool(entry.activities, selection.toolCall.id) ?? tool
      }
    }
  }

  function handleAfterClose(): void {
    setSelection(null)
    selection?.opener?.focus({ preventScroll: true })
  }

  return (
    <ActivityDetailsContext value={open}>
      {children}
      {selection?.kind === ActivityDetailsKind.Tool && tool && (
        <ConversationDetailsProvider sessionId={sessionId} messageId={selection.messageId}>
          <ToolDetailsDialog open={isOpen} toolCall={tool} technicalTitle={selection.technicalTitle}
            onClose={() => setIsOpen(false)} onAfterClose={handleAfterClose} />
        </ConversationDetailsProvider>
      )}
      {selection?.kind === ActivityDetailsKind.Text && (
        <ActivityDetailsDialog open={isOpen} title={selection.title} path={selection.path}
          content={selection.content} contentName={selection.contentName} downloadFilename={selection.path.split('/').at(-1)!}
          toolbar={<span className="activity-details-title">{selection.path.split('/').at(-1)}</span>}
          onClose={() => setIsOpen(false)} onAfterClose={handleAfterClose}>
          <div className="activity-details-reading-pane">
            <CodeView text={selection.content} language={selection.language} label={selection.contentName} />
          </div>
        </ActivityDetailsDialog>
      )}
    </ActivityDetailsContext>
  )
}

/**
 * Opens the feed-owned inspector with the invocation's existing response identity.
 */
export function useOpenToolDetails(toolCall: FeedToolCall, technicalTitle: string): () => void {
  const open = useContext(ActivityDetailsContext)
  const response = useContext(ConversationDetailsContext)

  return () => open?.({ kind: ActivityDetailsKind.Tool, toolCall, technicalTitle, messageId: response?.messageId ?? '',
    opener: document.activeElement instanceof HTMLElement ? document.activeElement : null })
}

/**
 * Keeps the loaded guidance inspectable when its feed row is unmounted.
 */
export function useOpenSkillDetails(skill: AgentSkillSnapshot): () => void {
  return useOpenTextActivityDetails({
    title: skill.name, content: skill.instructions,
    path: `${skill.name}/SKILL.md`, contentName: 'SKILL.md', language: 'markdown'
  })
}

/**
 * Reuses the feed-owned text inspector for saved guidance and memory evidence.
 */
export function useOpenTextActivityDetails(details: Omit<TextSelection, 'kind' | 'opener'>): () => void {
  const open = useContext(ActivityDetailsContext)

  return () => open?.({ kind: ActivityDetailsKind.Text, ...details,
    opener: document.activeElement instanceof HTMLElement ? document.activeElement : null })
}
