import {
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
  type RefObject
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useNavigate, useParams } from '@tanstack/react-router'

import { useSessions, useSessionMutation } from '@/data/sessions'
import { useProfile } from '@/data/profile'
import { SessionListItem } from '@/layout/sidebar/session-list-item'

import './session-list.sass'

const SESSION_ITEM_ESTIMATED_HEIGHT = 41
const SESSION_LIST_OVERSCAN = 5
const SCROLL_MASK_FADE_DISTANCE_PX = 54

interface SessionListProps {
  collapsed?: boolean
  scrollElementRef: RefObject<HTMLDivElement | null>
}

export function SessionList({
  collapsed = false,
  scrollElementRef
}: SessionListProps) {
  const navigate = useNavigate()
  const { sessionId: viewedSessionId } = useParams({ strict: false })
  const profile = useProfile()
  const query = useSessions(profile)
  const mutation = useSessionMutation(profile)
  const scrollMaskRef = useRef<HTMLDivElement>(null)
  const virtualListRef = useRef<HTMLUListElement>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  const sessions = query.sessions
  const rowVirtualizer = useVirtualizer({
    count: sessions.length,
    getItemKey: (index) => sessions[index]?.id ?? index,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => SESSION_ITEM_ESTIMATED_HEIGHT,
    overscan: SESSION_LIST_OVERSCAN,
    scrollMargin
  })
  const lastVisibleIndex = rowVirtualizer.getVirtualItems().at(-1)?.index ?? -1
  useEffect(() => {
    if (!collapsed && lastVisibleIndex >= sessions.length - SESSION_LIST_OVERSCAN &&
      query.hasNextPage && !query.isFetching && !query.isError) {
      void query.fetchNextPage()
    }
  }, [collapsed, lastVisibleIndex, sessions.length, query.hasNextPage, query.isFetching, query.isError, query.fetchNextPage])

  function renameSession(sessionId: string, nextTitle: string): void {
    const title = nextTitle.trim()
    const session = sessions.find((currentSession) =>
      currentSession.id === sessionId
    )

    if (
      session === undefined ||
      title.length === 0 ||
      title === session.title
    ) {
      return
    }

    mutation.mutate({ id: sessionId, changes: { title } })
  }

  function deleteSession(sessionId: string): void {
    mutation.mutate({ id: sessionId }, {
      onSuccess: () => {
        if (sessionId === viewedSessionId) {
          void navigate({ to: '/' })
        }
      }
    })
  }

  useLayoutEffect(() => {
    const virtualList = virtualListRef.current
    const scrollMask = scrollMaskRef.current

    if (virtualList === null || scrollMask === null) {
      return undefined
    }

    const scrollElement = virtualList.closest<HTMLDivElement>(
      '.sidebar-scroll-area'
    )

    if (scrollElement === null) {
      return undefined
    }

    const observedVirtualList = virtualList
    const observedScrollMask = scrollMask
    const observedScrollElement = scrollElement

    function updateScrollMaskOpacity(): void {
      const remainingScrollDistance = Math.max(
        0,
        observedScrollElement.scrollHeight -
        observedScrollElement.scrollTop -
        observedScrollElement.clientHeight
      )
      const maskOpacity = Math.min(
        remainingScrollDistance / SCROLL_MASK_FADE_DISTANCE_PX,
        1
      )

      observedScrollMask.style.opacity = String(maskOpacity)
    }

    // The sidebar scroll container starts above this list, so the virtual rows
    // need the list offset to keep their transforms local to the list element.
    function updateLayout(): void {
      setScrollMargin(observedVirtualList.offsetTop)
      updateScrollMaskOpacity()
    }

    updateLayout()

    const resizeObserver = new ResizeObserver(updateLayout)
    resizeObserver.observe(observedVirtualList)
    resizeObserver.observe(observedScrollElement)
    observedScrollElement.addEventListener('scroll', updateScrollMaskOpacity, {
      passive: true
    })

    return () => {
      resizeObserver.disconnect()
      observedScrollElement.removeEventListener(
        'scroll',
        updateScrollMaskOpacity
      )
    }
  }, [collapsed])

  if (collapsed) {
    return null
  }

  return (
    <nav className="session-list" aria-labelledby="session-list-title">
      <h2 className="session-list-title" id="session-list-title">
        Recents
      </h2>
      <ul
        className="session-list-items"
        ref={virtualListRef}
        style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const session = sessions[virtualRow.index]

          if (session === undefined) {
            return null
          }

          return (
            <SessionListItem
              key={session.id}
              id={session.id}
              isPinned={session.isPinned}
              status={session.status}
              title={session.title}
              onDelete={deleteSession}
              onRename={renameSession}
              onPin={(id) => mutation.mutate({ id, changes: { is_pinned: !session.isPinned } })}
              style={{
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start - rowVirtualizer.options.scrollMargin}px)`
              }}
            />
          )
        })}
      </ul>
      {profile && query.isPending && <p role="status">Loading sessions…</p>}
      {query.isError && <button type="button" onClick={() => void query.refetch()}>Retry loading sessions</button>}
      <div
        ref={scrollMaskRef}
        className="session-list-mask"
        aria-hidden="true"
      />
    </nav>
  )
}
