import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import { Dropdown } from '@/components/dropdown'
import { Button } from '@/components/button'
import { Input } from '@/components/input'
import { Icon } from '@/components/icon'
import { WorkspaceDialog } from '@/components/workspace-dialog/workspace-dialog'
import { useWorkspaces, type WorkspaceSummary } from '@/data/workspaces'
import { useProfile } from '@/data/profile'
import { createSearchIndex, searchIndex } from '@/utils/search'
import { getListNavigationIndex } from '@/utils/list-navigation'

const PICKER_WIDTH = 352
const PICKER_HEIGHT = 360
const ROW_HEIGHT = 40

interface WorkspaceSelectorProps {
  value: string | null
  onChange: (id: string | null) => void
  disabled?: boolean
}

/**
 * Makes the new conversation's project context explicit before its first prompt.
 */
export function WorkspaceSelector({ value, onChange, disabled = false }: WorkspaceSelectorProps) {
  const query = useWorkspaces(useProfile())
  const [creating, setCreating] = useState(false)
  const selected = query.data?.workspaces.find((workspace) => workspace.id === value)

  return <div className="workspace-selector" data-workspace-color={selected?.color}>
    <Dropdown disabled={disabled || query.isPending} width={PICKER_WIDTH} height={PICKER_HEIGHT}
      contentLabel="Choose a workspace" content={(close, open) => <WorkspaceMenu open={open}
        workspaces={query.data?.workspaces ?? []} value={value} onChoose={(id) => {
          onChange(id)
          close()
        }} onCreate={() => {
          close()
          setCreating(true)
        }} />}>
      {(open, contentId) => <Button iconName="folder" size="md" disabled={disabled} ariaExpanded={open}
        ariaHasPopup="dialog" ariaControls={open ? contentId : undefined}>
        {selected?.name ?? (value ? 'Workspace unavailable' : 'Attach workspace')}
      </Button>}
    </Dropdown>
    {creating && <WorkspaceDialog onClose={() => setCreating(false)} onCreated={onChange} />}
  </div>
}

function WorkspaceMenu({ open, workspaces, value, onChoose, onCreate }: {
  open: boolean
  workspaces: WorkspaceSummary[]
  value: string | null
  onChoose: (id: string | null) => void
  onCreate: () => void
}) {
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement | HTMLTextAreaElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState<number | null>(null)
  const index = useMemo(() => createSearchIndex(workspaces, (workspace) => [workspace.name]), [workspaces])
  const matches = useMemo(() => searchIndex(index, query).map((result) => result.item), [index, query])
  const getItemKey = useCallback((position: number) => matches[position]!.id, [matches])
  const virtualizer = useVirtualizer({ count: matches.length, getItemKey,
    getScrollElement: () => list.current, estimateSize: () => ROW_HEIGHT, overscan: 3 })
  const virtualItems = virtualizer.getVirtualItems()

  useEffect(() => {
    if (open) {
      input.current?.focus()
    }
  }, [open])
  useEffect(() => {
    if (focused !== null) {
      const target = list.current?.querySelector<HTMLButtonElement>(`[data-choice-index="${focused}"]`)
      if (target) {
        target.focus()
        setFocused(null)
      }
    }
  }, [focused, virtualItems])

  return <div className="workspace-selector-menu" onKeyDown={(event) => {
    const target = event.target as HTMLElement
    const position = target.dataset['choiceIndex']
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && position === undefined) {
      return
    }
    const next = getListNavigationIndex(event, { count: matches.length, currentIndex: position === undefined ? -1 : Number(position) })
    if (next !== undefined) {
      event.preventDefault()
      virtualizer.scrollToIndex(next)
      setFocused(next)
    }
  }}>
    <Input fieldRef={input} type="search" ariaLabel="Find a workspace" placeholder="Search workspaces…" value={query}
      onChange={(event) => {
        setQuery(event.target.value)
        setFocused(null)
      }} />
    <button type="button" className="dropdown-item" role="menuitem" onClick={onCreate}>
      <Icon name="folder-add-line" className="dropdown-item-icon" /><span>New workspace</span>
    </button>
    <div className="workspace-selector-list" ref={list}>
      <div className="workspace-selector-rows" style={{ height: virtualizer.getTotalSize() }}>
        {virtualItems.map((row) => {
          const workspace = matches[row.index]!

          return <button type="button" className="dropdown-item" key={row.key} role="menuitem"
            data-choice-index={row.index} data-workspace-color={workspace.color}
            style={{ height: row.size, transform: `translateY(${row.start}px)` }} onClick={() => onChoose(workspace.id)}>
            <Icon name="folder-line" className="dropdown-item-icon workspace-choice-icon" />
            <span className="dropdown-item-label">{workspace.name}</span>
            {workspace.id === value && <Icon name="check-line" />}
          </button>
        })}
      </div>
      {matches.length === 0 && <p className="input-dropdown-message">No workspaces found.</p>}
    </div>
    {value && <button type="button" className="dropdown-item" role="menuitem" onClick={() => onChoose(null)}>
      <Icon name="close-line" className="dropdown-item-icon" /><span>Detach workspace</span>
    </button>}
  </div>
}
