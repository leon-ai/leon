import { Icon } from '@/components/icon'
import {
  memo,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent
} from 'react'
import { Link } from '@tanstack/react-router'
import { clsx } from 'clsx'

import { Button } from '@/components/button'
import { Dialog } from '@/components/dialog'
import { Dropdown } from '@/components/dropdown'
import { Input } from '@/components/input'
import { StreamingText } from '@/components/streaming-text'
import { SessionStatus } from '@/data/sessions'
import type { WorkspaceColor } from '../../../../../../bridges/runtime/contracts/workspace'
import { canPrefetch } from '@/utils/prefetch'

import { SessionWorkIndicator } from './session-work-indicator'

import './session-list-item.sass'

const TITLE_SCROLL_SPEED_PX_PER_SECOND = 24
const TITLE_SCROLL_INITIAL_DELAY_MS = 500
const TITLE_SCROLL_END_PAUSE_MS = 2_000
const TITLE_SCROLL_START_PAUSE_MS = 2_000
const TITLE_SCROLL_RETURN_DURATION_MS = 320
const TITLE_MASK_FADE_DURATION_MS = 120
const MINIMUM_TITLE_OVERFLOW_PX = 1
const REDUCED_MOTION_MEDIA_QUERY = '(prefers-reduced-motion: reduce)'

interface SessionListItemProps {
  id: string
  workspaceId?: string | undefined
  rowKind?: 'session' | 'workspace'
  workspaceColor?: WorkspaceColor
  expanded?: boolean
  onToggle?: (id: string) => void
  onNewSession?: (id: string) => void
  onEdit?: (id: string) => void
  isExplicitlyPinned?: boolean
  isPinned: boolean
  isUnread: boolean
  isListScrolling: () => boolean
  status: SessionStatus
  onDelete: (sessionId: string) => void
  onRename?: (sessionId: string, title: string) => void
  onPin?: (sessionId: string, isPinned: boolean) => void
  title: string
  timestamp: number
  relativeTime: string
  height: number
  offset: number
}

export const SessionListItem = memo(function SessionListItem({
  id,
  workspaceId,
  rowKind = 'session',
  workspaceColor,
  expanded = false,
  onToggle,
  onNewSession,
  onEdit,
  isPinned,
  isExplicitlyPinned = false,
  isUnread,
  isListScrolling,
  status,
  onDelete,
  onRename,
  onPin,
  title,
  timestamp,
  relativeTime,
  height,
  offset
}: SessionListItemProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const titleAnimationFrameRef = useRef<number | null>(null)
  const titleScrollTimerRef = useRef<number | undefined>(undefined)
  const titleAnimationsRef = useRef<Animation[]>([])
  const titleLeftMaskRef = useRef<HTMLSpanElement>(null)
  const titleRightMaskRef = useRef<HTMLSpanElement>(null)
  const titleTextRef = useRef<HTMLSpanElement>(null)
  const titleViewportRef = useRef<HTMLSpanElement>(null)
  const [editing, setEditing] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [draftTitle, setDraftTitle] = useState(title)
  const isWorkspace = rowKind === 'workspace'
  const isWorking = status === SessionStatus.Wip
  const showUnread = isUnread && !isWorking
  const actionPinned = isWorkspace ? isExplicitlyPinned : isPinned
  const pinDropdownItem = actionPinned
    ? {
        iconName: 'unpin',
        label: 'Unpin'
      }
    : {
        iconName: 'pushpin',
        label: 'Pin'
      }

  useEffect(() => {
    if (!editing) {
      setDraftTitle(title)
      return
    }

    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing, title])

  useEffect(() => () => {
    window.clearTimeout(titleScrollTimerRef.current)
    titleScrollTimerRef.current = undefined
    if (titleAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(titleAnimationFrameRef.current)
      titleAnimationFrameRef.current = null
    }

    titleAnimationsRef.current.forEach((animation) => animation.cancel())
    titleAnimationsRef.current = []
    titleViewportRef.current?.classList.remove(
      'session-list-item-title-scrolling'
    )
  }, [title])

  function stopTitleScroll(): void {
    window.clearTimeout(titleScrollTimerRef.current)
    titleScrollTimerRef.current = undefined
    if (titleAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(titleAnimationFrameRef.current)
      titleAnimationFrameRef.current = null
    }

    titleAnimationsRef.current.forEach((animation) => animation.cancel())
    titleAnimationsRef.current = []
    titleViewportRef.current?.classList.remove(
      'session-list-item-title-scrolling'
    )
  }

  function startTitleScroll(): void {
    stopTitleScroll()

    if (isListScrolling() || document.hidden || window.matchMedia(REDUCED_MOTION_MEDIA_QUERY).matches) {
      return
    }

    // Scrolling moves rows beneath a stationary pointer. Wait for actual intent
    // before measuring text, rather than forcing layout for every passing row.
    titleScrollTimerRef.current = window.setTimeout(() => {
      titleScrollTimerRef.current = undefined
      animateTitleScroll()
    }, TITLE_SCROLL_INITIAL_DELAY_MS)
  }

  function animateTitleScroll(): void {
    titleAnimationFrameRef.current = window.requestAnimationFrame(() => {
      titleAnimationFrameRef.current = null

      if (isListScrolling() || document.hidden) {
        return
      }

      const titleText = titleTextRef.current
      const titleViewport = titleViewportRef.current
      const titleLeftMask = titleLeftMaskRef.current
      const titleRightMask = titleRightMaskRef.current

      if (
        titleText === null ||
        titleViewport === null ||
        titleLeftMask === null ||
        titleRightMask === null
      ) {
        return
      }

      const overflowDistance = titleText.scrollWidth - titleViewport.clientWidth

      if (overflowDistance <= MINIMUM_TITLE_OVERFLOW_PX) {
        return
      }

      titleViewport.classList.add('session-list-item-title-scrolling')

      const scrollDuration = (
        overflowDistance / TITLE_SCROLL_SPEED_PX_PER_SECOND
      ) * 1_000
      const totalDuration =
        scrollDuration +
        TITLE_SCROLL_END_PAUSE_MS +
        TITLE_SCROLL_RETURN_DURATION_MS +
        TITLE_SCROLL_START_PAUSE_MS
      const scrollEndOffset = scrollDuration / totalDuration
      const endPauseOffset = (
        scrollDuration + TITLE_SCROLL_END_PAUSE_MS
      ) / totalDuration
      const returnEndOffset = (
        scrollDuration +
        TITLE_SCROLL_END_PAUSE_MS +
        TITLE_SCROLL_RETURN_DURATION_MS
      ) / totalDuration
      const outboundMaskFadeOffset = Math.min(
        TITLE_MASK_FADE_DURATION_MS,
        scrollDuration
      ) / totalDuration
      const returnMaskFadeOffset = Math.min(
        TITLE_MASK_FADE_DURATION_MS,
        TITLE_SCROLL_RETURN_DURATION_MS
      ) / totalDuration
      const animationOptions: KeyframeAnimationOptions = {
        duration: totalDuration,
        easing: 'linear',
        fill: 'backwards',
        iterations: Number.POSITIVE_INFINITY
      }

      const textAnimation = titleText.animate([
        {
          transform: 'translateX(0)',
          offset: 0
        },
        {
          transform: `translateX(-${overflowDistance}px)`,
          offset: scrollEndOffset
        },
        {
          transform: `translateX(-${overflowDistance}px)`,
          offset: endPauseOffset,
          easing: 'ease-in-out'
        },
        {
          transform: 'translateX(0)',
          offset: returnEndOffset
        },
        {
          transform: 'translateX(0)',
          offset: 1
        }
      ], animationOptions)

      const leftMaskAnimation = titleLeftMask.animate([
        { opacity: 0, offset: 0 },
        { opacity: 1, offset: outboundMaskFadeOffset },
        { opacity: 1, offset: endPauseOffset },
        {
          opacity: 1,
          offset: returnEndOffset - returnMaskFadeOffset
        },
        { opacity: 0, offset: returnEndOffset },
        { opacity: 0, offset: 1 }
      ], animationOptions)
      const rightMaskAnimation = titleRightMask.animate([
        { opacity: 1, offset: 0 },
        {
          opacity: 1,
          offset: scrollEndOffset - outboundMaskFadeOffset
        },
        { opacity: 0, offset: scrollEndOffset },
        { opacity: 0, offset: endPauseOffset },
        {
          opacity: 1,
          offset: endPauseOffset + returnMaskFadeOffset
        },
        { opacity: 1, offset: 1 }
      ], animationOptions)

      titleAnimationsRef.current = [
        textAnimation,
        leftMaskAnimation,
        rightMaskAnimation
      ]
    })
  }

  function handleTitlePointerMove(): void {
    if (titleScrollTimerRef.current === undefined && titleAnimationFrameRef.current === null &&
      titleAnimationsRef.current.length === 0 && !isListScrolling()) {
      startTitleScroll()
    }
  }

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

    if (titleToCommit.length > 0 && titleToCommit !== title.trim()) {
      onRename?.(id, titleToCommit)
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

  const rowContents = <>
    {isWorkspace && <Icon className="workspace-row-icon" name={expanded ? 'folder-open-line' : 'folder-line'} morph />}
          {isWorking && <SessionWorkIndicator />}
          <span
            ref={titleViewportRef}
            className="session-list-item-title"
          >
            <StreamingText
              className="session-list-item-title-resting"
              animationId={`${id}-title-resting`}
              animateInitial={false}
              compact
              text={title}
            />
            <span
              ref={titleTextRef}
              className="session-list-item-title-text"
              aria-hidden="true"
            >
              <StreamingText
                animationId={`${id}-title-scrolling`}
                animateInitial={false}
                compact
                text={title}
              />
            </span>
            <span
              ref={titleLeftMaskRef}
              className={clsx(
                'session-list-item-title-mask',
                'session-list-item-title-mask-left'
              )}
              aria-hidden="true"
            />
            <span
              ref={titleRightMaskRef}
              className={clsx(
                'session-list-item-title-mask',
                'session-list-item-title-mask-right'
              )}
              aria-hidden="true"
            />
          </span>
          {relativeTime && (
            <time
              className="session-list-item-time"
              dateTime={new Date(timestamp).toISOString()}
            >
              {relativeTime}
            </time>
          )}
  </>

  return (
    <li
      data-workspace-id={workspaceId}
      data-workspace-color={workspaceColor}
      className={clsx('session-list-item list-item-slot', {
        'workspace-row': isWorkspace,
        'session-list-item-editing': editing,
        'session-list-item-pinned': isPinned,
        'session-list-item-wip': isWorking,
        'session-list-item-unread': showUnread
      })}
      style={{ height: `${height}px`, transform: `translateY(${offset}px)` }}
      onMouseEnter={startTitleScroll}
      onMouseLeave={stopTitleScroll}
      onMouseMove={handleTitlePointerMove}
      onWheelCapture={stopTitleScroll}
      onTouchStartCapture={stopTitleScroll}
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
      ) : isWorkspace ? (
        <button type="button" className="session-list-item-link workspace-row-toggle"
          aria-expanded={expanded} data-navigation-id={id}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${title}`}
          onClick={() => onToggle?.(id)}
          onFocus={startTitleScroll} onBlur={stopTitleScroll}>
          {rowContents}
        </button>
      ) : (
        <Link
          preload={canPrefetch() ? 'intent' : false}
          to="/session/$sessionId"
          params={{ sessionId: id }}
          className="session-list-item-link"
          data-session-id={id}
          aria-label={isWorking ? `${title}, Leon is working` : showUnread ? `${title}, Unread response` : title}
          activeProps={{
            className: clsx('session-list-item-link', 'session-list-item-active')
          }}
          onDoubleClick={(event) => {
            event.preventDefault()
            startEditing()
          }}
          onFocus={startTitleScroll}
          onBlur={stopTitleScroll}
        >
          {rowContents}
        </Link>
      )}
      <div className="session-list-item-trailing">
        {isPinned && (
          <Icon name="pushpin-fill" className="session-list-item-pinned-icon" />
        )}
        {showUnread && (
          <span className="session-list-item-unread-dot" {...(isWorkspace ? { role: 'img', 'aria-label': 'Unread results' } : { 'aria-hidden': true })} />
        )}
        <div className="session-list-item-actions">
          {isWorkspace && <Button compact feedback="color" tone="muted" iconName="edit-box" ariaLabel={`New session in ${title}`}
            onClick={() => onNewSession?.(id)} />}
          <Dropdown
            items={isWorkspace ? [
              { iconName: 'edit', label: 'Edit', onSelect: () => onEdit?.(id) },
              { ...pinDropdownItem, onSelect: () => onPin?.(id, actionPinned) },
              { iconName: 'delete-bin', label: 'Delete', variant: 'danger', onSelect: () => setDeleteDialogOpen(true) }
            ] : [
              {
                iconName: 'edit',
                label: 'Rename',
                onSelect: startEditing
              },
              { ...pinDropdownItem, onSelect: () => onPin?.(id, isPinned) },
              {
                iconName: 'delete-bin',
                label: 'Delete',
                onSelect: () => setDeleteDialogOpen(true),
                variant: 'danger'
              }
            ]}
          >
            {(open, contentId) => <Button compact feedback="color" iconName="more-2" tone="muted"
              ariaExpanded={open} ariaControls={open ? contentId : undefined} ariaHasPopup="menu"
              ariaLabel={isWorkspace ? `${title} options` : 'Session options'} /> }
          </Dropdown>
        </div>
      </div>
      <Dialog
        open={deleteDialogOpen}
        role="alertdialog"
        title={isWorkspace ? 'Delete workspace?' : 'You sure?'}
        description={isWorkspace ? 'Your conversations will return to Recents. Your resources and their files will stay where they are.' : 'This action cannot be undone. This will permanently delete the session.'}
        actions={[
          {
            label: 'Cancel',
            variant: 'secondary',
            onClick: () => setDeleteDialogOpen(false)
          },
          {
            label: isWorkspace ? 'Delete workspace' : 'Delete session',
            variant: 'danger',
            onClick: confirmDelete
          }
        ]}
        onClose={() => setDeleteDialogOpen(false)}
      />
    </li>
  )
})
