import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

import { ConversationDetailsProvider, ConversationDetailsContext } from '@/data/conversation-details'
import type { FeedEntry, FeedToolCall, LeonFeedActivity } from '@/data/feed'
import type { AgentSkillSnapshot } from '../../../../../server/src/core/llm-manager/agent-progress-contract'
import { CodeView } from '@/components/code-view'
import { ToolDetailsDialog } from '@/components/tool-call/tool-details-dialog'
import { ActivityDetailsDialog } from './activity-details-dialog'

enum ActivityDetailsKind {
  Tool = 'tool',
  Skill = 'skill'
}

interface ToolSelection {
  kind: ActivityDetailsKind.Tool
  toolCall: FeedToolCall
  technicalTitle: string
  messageId: string
  opener: HTMLElement | null
}

interface SkillSelection {
  kind: ActivityDetailsKind.Skill
  skill: AgentSkillSnapshot
  opener: HTMLElement | null
}

type ActivitySelection = ToolSelection | SkillSelection

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
      {selection?.kind === ActivityDetailsKind.Skill && (
        <ActivityDetailsDialog open={isOpen} title={selection.skill.name} path={`${selection.skill.name}/SKILL.md`}
          content={selection.skill.instructions} contentName="SKILL.md" downloadFilename="SKILL.md"
          toolbar={<span className="activity-details-title">SKILL.md</span>}
          onClose={() => setIsOpen(false)} onAfterClose={handleAfterClose}>
          <div className="activity-details-reading-pane">
            <CodeView text={selection.skill.instructions} language="markdown" label="SKILL.md" />
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
  const open = useContext(ActivityDetailsContext)

  return () => open?.({ kind: ActivityDetailsKind.Skill, skill,
    opener: document.activeElement instanceof HTMLElement ? document.activeElement : null })
}
