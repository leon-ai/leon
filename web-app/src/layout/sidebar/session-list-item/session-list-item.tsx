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
  const titleAnimationFrameRef = useRef<number | null>(null)
  const titleAnimationsRef = useRef<Animation[]>([])
  const titleLeftMaskRef = useRef<HTMLSpanElement>(null)
  const titleRightMaskRef = useRef<HTMLSpanElement>(null)
  const titleTextRef = useRef<HTMLSpanElement>(null)
  const titleViewportRef = useRef<HTMLSpanElement>(null)
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

  useEffect(() => () => {
    if (titleAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(titleAnimationFrameRef.current)
    }

    titleAnimationsRef.current.forEach((animation) => animation.cancel())
    titleAnimationsRef.current = []
    titleViewportRef.current?.classList.remove(
      'session-list-item-title-scrolling'
    )
  }, [title])

  function stopTitleScroll(): void {
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

    if (window.matchMedia(REDUCED_MOTION_MEDIA_QUERY).matches) {
      return
    }

    // Measure on the next frame after hover actions have claimed their space.
    titleAnimationFrameRef.current = window.requestAnimationFrame(() => {
      titleAnimationFrameRef.current = null

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
        delay: TITLE_SCROLL_INITIAL_DELAY_MS,
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
      onMouseEnter={startTitleScroll}
      onMouseLeave={stopTitleScroll}
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
          onFocus={startTitleScroll}
          onBlur={stopTitleScroll}
        >
          <span
            ref={titleViewportRef}
            className="session-list-item-title"
          >
            <span className="session-list-item-title-resting">
              {title}
            </span>
            <span
              ref={titleTextRef}
              className="session-list-item-title-text"
              aria-hidden="true"
            >
              {title}
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
