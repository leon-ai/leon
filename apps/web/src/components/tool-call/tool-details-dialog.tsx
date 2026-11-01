import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/button'
import { useToast } from '@/components/toast'
import type { ToolContentPart } from '../../../../../server/src/core/session-manager/tool-content-contract'
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
  const { showToast } = useToast()
  const downloadURL = useRef<string | undefined>(undefined)
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

  useEffect(() => (): void => {
    if (downloadURL.current) {
      URL.revokeObjectURL(downloadURL.current)
    }
  }, [])

  async function copy(content: ToolContentPart | undefined, label: string): Promise<void> {
    if (!content) {
      return
    }
    try {
      await navigator.clipboard.writeText(content.text)
      showToast({ type: 'success', title: `Copied ${label}`, description: 'The text is in your clipboard.' })
    } catch {
      showToast({ type: 'error', title: 'I couldn’t copy this text',
        description: 'Your browser did not allow clipboard access. You can download the output instead.' })
    }
  }

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

  function download(): void {
    if (!content) {
      return
    }
    if (downloadURL.current) {
      URL.revokeObjectURL(downloadURL.current)
    }
    const url = URL.createObjectURL(new Blob([content.text], { type: 'text/plain;charset=utf-8' }))
    downloadURL.current = url
    const link = document.createElement('a')
    link.href = url
    link.download = `tool-${contentName}.txt`
    link.click()
  }

  return (
    <Dialog open={open} size="wide" title={toolCall.toolCallTitle || 'Tool details'} className="tool-details-dialog"
      onClose={onClose} onAfterClose={onAfterClose} footer={(
        <>
          <Button iconName="download" tone="muted" tooltipMessage={`Download ${contentName}`} tooltipPosition="left"
            disabled={!content} onClick={download} />
        </>
      )}>
      <p className="tool-details-path">{technicalTitle}</p>
      {contents.fetchStatus === 'paused' && (
        <p className="tool-diff-notice" role="status">Check your network connection to load complete tool details.</p>
      )}
      <div className="tool-details-toolbar">
        <div className="tool-details-tabs" role="tablist" aria-label="Tool details" onKeyDown={handleTabsKeyDown}>
          {tabs.map((item) => (
            <button key={item} type="button" role="tab" id={`${tabsId}-${item}`}
              className="button button-ghost button-md button-tone-muted tool-details-tab"
              aria-selected={item === tab} aria-controls={`${tabsId}-panel`} tabIndex={item === tab ? 0 : -1}
              onClick={() => setSelectedTab(item)}>{item}</button>
          ))}
        </div>
        {tab !== ToolDetailsTab.Changes && (
          <Button iconName="file-copy" tone="muted" tooltipMessage={`Copy ${contentName}`} tooltipPosition="left"
            disabled={!content} onClick={() => void copy(content, contentName)} />
        )}
      </div>
      <div className="tool-details-reading-pane" role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${tab}`}>
        {tab === ToolDetailsTab.Changes ? (
          <ToolChanges changes={changes} truncated={contents.data?.diffTruncated ?? false}
            fallback={<ToolOutput content={output} label="Tool output" />} />
        ) : (
          <ToolOutput key={tab} content={content} label={tab === ToolDetailsTab.Input ? 'Input JSON' : 'Output JSON'}
            active={active} loading={contents.isFetching} />
        )}
      </div>
      {contents.isError && <Button onClick={() => void contents.refetch()}>Retry loading tool details</Button>}
    </Dialog>
  )
}
