import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent
} from 'react'
import { Link } from '@tanstack/react-router'
import { clsx } from 'clsx'

import { Button } from '../../../components/button'
import { Dialog } from '../../../components/dialog'
import { Dropdown } from '../../../components/dropdown'
import { Input } from '../../../components/input'

import './session-list-item.sass'

interface SessionListItemProps {
  id: string
  isPinned: boolean
  onDelete: (sessionId: string) => void
  onRename: (sessionId: string, title: string) => void
  title: string
  style?: CSSProperties
}

export function SessionListItem({
  id,
  isPinned,
  onDelete,
  onRename,
  title,
  style
}: SessionListItemProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [draftTitle, setDraftTitle] = useState(title)
  const pinDropdownItem = isPinned
    ? {
        iconName: 'unpin',
        label: 'Unpin session'
      }
    : {
        iconName: 'pushpin',
        label: 'Pin session'
      }

  useEffect(() => {
    if (!editing) {
      setDraftTitle(title)
      return
    }

    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing, title])

  function startEditing(): void {
    setDraftTitle(title)
    setEditing(true)
  }

  function cancelEditing(): void {
    setDraftTitle(title)
    setEditing(false)
  }

  function commitEditing(): void {
    const titleToCommit = draftTitle.trim()

    if (titleToCommit.length > 0) {
      onRename(id, titleToCommit)
    }

    setEditing(false)
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitEditing()
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      cancelEditing()
    }
  }

  function confirmDelete(): void {
    onDelete(id)
    setDeleteDialogOpen(false)
  }

  return (
    <li
      className={clsx('session-list-item', {
        'session-list-item-editing': editing,
        'session-list-item-pinned': isPinned
      })}
      style={style}
    >
      {editing ? (
        <Input
          ariaLabel="Session title"
          className="session-list-item-input"
          fieldRef={(element) => {
            inputRef.current = element instanceof HTMLInputElement ? element : null
          }}
          value={draftTitle}
          onBlur={commitEditing}
          onChange={(event) => setDraftTitle(event.target.value)}
          onKeyDown={handleInputKeyDown}
        />
      ) : (
        <Link
          to="/session/$sessionId"
          params={{ sessionId: id }}
          className="session-list-item-link"
          activeProps={{
            className: clsx('session-list-item-link', 'session-list-item-active')
          }}
          onDoubleClick={(event) => {
            event.preventDefault()
            startEditing()
          }}
        >
          <span className="session-list-item-title">{title}</span>
        </Link>
      )}
      {isPinned && (
        <i
          className="session-list-item-pinned-icon ri-unpin-fill"
          aria-hidden="true"
        />
      )}
      <div className="session-list-item-actions">
        <Dropdown
          items={[
            {
              iconName: 'edit',
              label: 'Rename',
              onSelect: startEditing
            },
            pinDropdownItem,
            {
              iconName: 'delete-bin',
              label: 'Delete',
              onSelect: () => setDeleteDialogOpen(true),
              variant: 'danger'
            }
          ]}
        >
          <Button
            iconName="more-2"
            tone="muted"
            ariaLabel="Session options"
          />
        </Dropdown>
      </div>
      <Dialog
        open={deleteDialogOpen}
        role="alertdialog"
        title="You sure?"
        description="This action cannot be undone. This will permanently delete the session."
        actions={[
          {
            label: 'Cancel',
            variant: 'secondary',
            onClick: () => setDeleteDialogOpen(false)
          },
          {
            label: 'Delete session',
            variant: 'danger',
            onClick: confirmDelete
          }
        ]}
        onClose={() => setDeleteDialogOpen(false)}
      />
    </li>
  )
}
