import {
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
  type RefObject,
  type KeyboardEvent
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useNavigate, useParams } from '@tanstack/react-router'

import { useSessions, useSessionMutation } from '@/data/sessions'
import { useProfile } from '@/data/profile'
import { useSessionReadState } from '@/data/session-read-state'
import { SessionListItem } from '@/layout/sidebar/session-list-item'
import { Loader } from '@/components/loader'
import { getListNavigationIndex } from '@/utils/list-navigation'

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
  const readState = useSessionReadState(profile)
  const query = useSessions(profile)
  const mutation = useSessionMutation(profile)
  const scrollMaskRef = useRef<HTMLDivElement>(null)
  const virtualListRef = useRef<HTMLUListElement>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null)
  const sessions = query.sessions
  const rowVirtualizer = useVirtualizer({
    count: sessions.length,
    getItemKey: (index) => sessions[index]?.id ?? index,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => SESSION_ITEM_ESTIMATED_HEIGHT,
    overscan: SESSION_LIST_OVERSCAN,
    scrollPaddingStart: SCROLL_MASK_FADE_DISTANCE_PX,
    scrollPaddingEnd: SCROLL_MASK_FADE_DISTANCE_PX,
    scrollMargin
  })
  const virtualItems = rowVirtualizer.getVirtualItems()
  const lastVisibleIndex = virtualItems.at(-1)?.index ?? -1
  useEffect(() => {
    if (!collapsed && lastVisibleIndex >= sessions.length - SESSION_LIST_OVERSCAN &&
      query.hasNextPage && !query.isFetching && !query.isError) {
      void query.fetchNextPage()
    }
  }, [collapsed, lastVisibleIndex, sessions.length, query.hasNextPage, query.isFetching, query.isError, query.fetchNextPage])

  useLayoutEffect(() => {
    if (!pendingFocusId) {
      return
    }
    const list = virtualListRef.current
    // A virtual row may mount after scrolling. Do not steal focus back if the
    // owner has meanwhile moved to another control or started editing a title.
    if (document.activeElement !== document.body &&
      !(document.activeElement instanceof HTMLAnchorElement && list?.contains(document.activeElement))) {
      setPendingFocusId(null)
      return
    }
    const target = list?.querySelector<HTMLElement>(`[data-session-id="${CSS.escape(pendingFocusId)}"]`)
    if (target) {
      target.focus({ preventScroll: true })
      setPendingFocusId(null)
    }
  }, [pendingFocusId, virtualItems])

  function handleListKeyDown(event: KeyboardEvent<HTMLUListElement>): void {
    const target = event.target
    if (!(target instanceof HTMLAnchorElement) || !target.dataset['sessionId']) {
      return
    }
    const currentIndex = sessions.findIndex((session) => session.id === target.dataset['sessionId'])
    const next = getListNavigationIndex(event, { count: sessions.length, currentIndex })
    if (next === undefined) {
      return
    }
    event.preventDefault()
    const session = sessions[next]
    if (session) {
      setPendingFocusId(session.id)
      rowVirtualizer.scrollToIndex(next, { align: 'auto' })
    }
  }

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
        onKeyDown={handleListKeyDown}
        style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
      >
        {virtualItems.map((virtualRow) => {
          const session = sessions[virtualRow.index]

          if (session === undefined) {
            return null
          }

          return (
            <SessionListItem
              key={session.id}
              id={session.id}
              isPinned={session.isPinned}
              isUnread={session.id !== viewedSessionId && Object.hasOwn(readState.unread, session.id)}
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
      {profile && query.isPending && <Loader size="sm" label="Loading sessions…" />}
      {query.isError && <button type="button" onClick={() => void query.refetch()}>Retry loading sessions</button>}
      <div
        ref={scrollMaskRef}
        className="session-list-mask"
        aria-hidden="true"
      />
    </nav>
  )
}
