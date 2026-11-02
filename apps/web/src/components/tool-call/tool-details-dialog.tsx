import { useId, useMemo, useState, type KeyboardEvent } from 'react'

import { ActivityDetailsDialog } from '@/components/activity-details/activity-details-dialog'
import { Button } from '@/components/button'
import { useToolCallContents } from '@/data/conversation-details'
import type { FeedToolCall } from '@/data/feed'
import { toToolContent, toToolInput } from '@/utils/tool-content'
import { getToolChanges, hasToolChanges } from '@/utils/tool-changes'
import { ToolChanges, ToolOutput } from './tool-output'
import { getListNavigationIndex } from '@/utils/list-navigation'

enum ToolDetailsTab {
  Input = 'Input',
  Output = 'Output',
  Changes = 'Changes'
}

interface ToolDetailsDialogProps {
  open: boolean
  toolCall: FeedToolCall
  technicalTitle: string
  onClose: () => void
  onAfterClose: () => void
}

/**
 * Owns the complete invocation payload only while its inspector is open.
 */
export function ToolDetailsDialog({ open, toolCall, technicalTitle, onClose, onAfterClose }: ToolDetailsDialogProps) {
  const contents = useToolCallContents(toolCall.id, open, true)
  const tabsId = useId()
  const [selectedTab, setSelectedTab] = useState<ToolDetailsTab | null>(null)
  const liveInput = useMemo(() => toToolInput(toolCall.input === null ? undefined : toolCall.input, true), [toolCall.input])
  const liveOutput = useMemo(() => toToolContent(toolCall.output, true), [toolCall.output])
  const liveCommand = useMemo(() => toToolContent(toolCall.commandOutput, true), [toolCall.commandOutput])
  const input = liveInput ?? contents.data?.input
  const result = liveOutput ?? contents.data?.output
  const command = liveCommand ?? contents.data?.commandOutput ?? contents.data?.displayOutput
  const output = command ?? result
  const active = toolCall.status === 'preparing' || toolCall.status === 'running'
  const changesAvailable = toolCall.status === 'success' && (hasToolChanges(toolCall.output) || contents.data?.hasChanges === true)
  const changes = useMemo(() => getToolChanges(input, changesAvailable), [input, changesAvailable])
  const tabs = [ToolDetailsTab.Input, ToolDetailsTab.Output, ...(changes.length ? [ToolDetailsTab.Changes] : [])]
  const tab = selectedTab === ToolDetailsTab.Changes && !changes.length
    ? ToolDetailsTab.Output : selectedTab ?? (changes.length ? ToolDetailsTab.Changes : ToolDetailsTab.Output)
  const content = tab === ToolDetailsTab.Input ? input : output
  const contentName = tab === ToolDetailsTab.Input ? 'input' : 'output'

  function handleTabsKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const next = getListNavigationIndex(event, {
      count: tabs.length, currentIndex: tabs.indexOf(tab), horizontal: true, loop: true
    })
    if (next !== undefined && next >= 0) {
      event.preventDefault()
      setSelectedTab(tabs[next]!)
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
    }
  }

  return (
    <ActivityDetailsDialog open={open} title={toolCall.toolCallTitle || 'Tool details'} path={technicalTitle}
      content={content?.text} contentName={contentName} downloadFilename={`tool-${contentName}.txt`}
      canCopy={tab !== ToolDetailsTab.Changes} onClose={onClose} onAfterClose={onAfterClose}
      notice={contents.fetchStatus === 'paused' && (
        <p className="tool-diff-notice" role="status">Check your network connection to load complete tool details.</p>
      )} toolbar={(
        <div className="tool-details-tabs" role="tablist" aria-label="Tool details" onKeyDown={handleTabsKeyDown}>
          {tabs.map((item) => (
            <button key={item} type="button" role="tab" id={`${tabsId}-${item}`}
              className="button button-ghost button-md button-tone-muted tool-details-tab"
              aria-selected={item === tab} aria-controls={`${tabsId}-panel`} tabIndex={item === tab ? 0 : -1}
              onClick={() => setSelectedTab(item)}>{item}</button>
          ))}
        </div>
      )}>
      <div className="activity-details-reading-pane" role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${tab}`}>
        {tab === ToolDetailsTab.Changes ? (
          <ToolChanges changes={changes} truncated={contents.data?.diffTruncated ?? false}
            fallback={<ToolOutput content={output} label="Tool output" />} />
        ) : (
          <ToolOutput key={tab} content={content} label={tab === ToolDetailsTab.Input ? 'Input JSON' : 'Output JSON'}
            active={active} loading={contents.isFetching} />
        )}
      </div>
      {contents.isError && <Button onClick={() => void contents.refetch()}>Retry loading tool details</Button>}
    </ActivityDetailsDialog>
  )
}
