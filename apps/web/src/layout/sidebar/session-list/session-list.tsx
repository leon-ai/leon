import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useNavigate, useParams } from '@tanstack/react-router'

import { useSessions, useSessionMutation, SessionStatus, type ConversationSession } from '@/data/sessions'
import { useRecents, useWorkspaceMutation, type WorkspaceSummary } from '@/data/workspaces'
import { useProfile } from '@/data/profile'
import { useSessionReadState } from '@/data/session-read-state'
import { SessionListItem } from '@/layout/sidebar/session-list-item'
import { Icon } from '@/components/icon'
import { Loader } from '@/components/loader'
import { Button } from '@/components/button'
import { WorkspaceDialog } from '@/components/workspace-dialog/workspace-dialog'
import { getListNavigationIndex } from '@/utils/list-navigation'
import { formatRelativeDate } from '@/utils/format-date'

import './session-list.sass'

const ROW_HEIGHT = 41
const OVERSCAN = 5
const SCROLL_MASK_FADE_DISTANCE_PX = 54
const RECENCY_REFRESH_INTERVAL_MS = 60_000
const RECENTS_STORAGE_PREFIX = 'leon.web-app.recents-expanded.'
const EXPANSION_STORAGE_PREFIX = 'leon.web-app.workspace-expanded.'

interface SessionListProps {
  collapsed?: boolean
  scrollElementRef: RefObject<HTMLDivElement | null>
}
interface GroupPage {
  sessions: ConversationSession[]
  hasNextPage: boolean
  isFetching: boolean
  isError: boolean
  fetchNextPage: () => unknown
  refetch: () => unknown
}
type NavigationRow =
  | { kind: 'session', id: string, session: ConversationSession }
  | { kind: 'workspace', id: string, workspace: WorkspaceSummary }
  | { kind: 'more', id: string, workspaceId: string }

function readRecentsExpanded(profile: string): boolean {
  try {
    return localStorage.getItem(`${RECENTS_STORAGE_PREFIX}${profile}`) !== 'false'
  } catch {
    return true
  }
}

function readExpanded(profile: string): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`${EXPANSION_STORAGE_PREFIX}${profile}`) ?? '[]')

    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').slice(0, 256) : [])
  } catch {
    return new Set()
  }
}

// Open groups own ordinary infinite queries. Their metadata joins one flat
// virtual list; collapsed groups never mount histories or nested scroll regions.
const GroupLoader = memo(function GroupLoader({ profile, id, onPage }: { profile: string, id: string, onPage: (id: string, page: GroupPage) => void }) {
  const query = useSessions(profile, '', id)
  useEffect(() => {
    onPage(id, { sessions: query.sessions, hasNextPage: query.hasNextPage, isFetching: query.isFetching,
      isError: query.isError, fetchNextPage: query.fetchNextPage, refetch: query.refetch })
  }, [id, onPage, query.sessions, query.hasNextPage, query.isFetching, query.isError, query.fetchNextPage, query.refetch])

  return null
})

/**
 * Resets browser navigation state when the authenticated profile changes.
 */
export function SessionList(props: SessionListProps) {
  const profile = useProfile()

  return <SessionCatalog key={profile} {...props} profile={profile} />
}

function SessionCatalog({ collapsed = false, scrollElementRef, profile }: SessionListProps & { profile: string }) {
  const navigate = useNavigate()
  const { sessionId: viewedSessionId } = useParams({ strict: false })
  const query = useRecents(profile)
  const mutation = useSessionMutation(profile)
  const workspaceMutation = useWorkspaceMutation(profile)
  const readState = useSessionReadState(profile)
  const virtualListRef = useRef<HTMLUListElement>(null)
  const scrollMaskRef = useRef<HTMLDivElement>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  const [recentsExpanded, setRecentsExpanded] = useState(() => readRecentsExpanded(profile))
  const [expanded, setExpanded] = useState(() => readExpanded(profile))
  const [groups, setGroups] = useState<Record<string, GroupPage>>({})
  const [editing, setEditing] = useState<WorkspaceSummary | 'new' | null>(null)
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now)
  const rows = useMemo(() => !recentsExpanded ? [] : query.items.flatMap((item): NavigationRow[] => {
    if (item.kind === 'session') {
      return [{ kind: 'session', id: item.value.id, session: item.value }]
    }
    const children = expanded.has(item.value.id) ? groups[item.value.id] : undefined

    return [
      { kind: 'workspace', id: item.value.id, workspace: item.value },
      ...(children?.sessions.map((session): NavigationRow => ({ kind: 'session', id: session.id, session })) ?? []),
      ...(expanded.has(item.value.id) && (!children || children.hasNextPage || children.isError)
        ? [{ kind: 'more' as const, id: `more:${item.value.id}`, workspaceId: item.value.id }] : [])
    ]
  }), [query.items, expanded, groups, recentsExpanded])
  const openWorkspaces = useMemo(() => query.items.filter((item) =>
    recentsExpanded && item.kind === 'workspace' && expanded.has(item.value.id)), [query.items, expanded, recentsExpanded])
  const getItemKey = useCallback((index: number) => rows[index]?.id ?? index, [rows])
  const rowVirtualizer = useVirtualizer({ count: rows.length, getItemKey,
    getScrollElement: () => scrollElementRef.current, estimateSize: () => ROW_HEIGHT, overscan: OVERSCAN,
    scrollPaddingStart: SCROLL_MASK_FADE_DISTANCE_PX, scrollPaddingEnd: SCROLL_MASK_FADE_DISTANCE_PX, scrollMargin })
  const isListScrolling = useCallback(() => rowVirtualizer.isScrolling, [rowVirtualizer])
  const virtualItems = rowVirtualizer.getVirtualItems()
  const lastVisibleIndex = virtualItems.at(-1)?.index ?? -1
  const hasRows = rows.length > 0
  const onPage = useCallback((id: string, page: GroupPage): void => {
    setGroups((previous) => ({ ...previous, [id]: page }))
  }, [])

  useEffect(() => {
    if (!collapsed && recentsExpanded && lastVisibleIndex >= rows.length - OVERSCAN && query.hasNextPage && !query.isFetching && !query.isError) {
      void query.fetchNextPage()
    }
  }, [collapsed, recentsExpanded, lastVisibleIndex, rows.length, query.hasNextPage, query.isFetching, query.isError, query.fetchNextPage])

  useEffect(() => {
    if (collapsed || !hasRows) {
      return
    }
    let interval: number | undefined
    const refresh = (): void => {
      window.clearInterval(interval)
      if (!document.hidden) {
        setNow(Date.now())
        interval = window.setInterval(() => setNow(Date.now()), RECENCY_REFRESH_INTERVAL_MS)
      }
    }
    refresh()
    document.addEventListener('visibilitychange', refresh)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [collapsed, hasRows])

  useLayoutEffect(() => {
    if (!pendingFocusId) {
      return
    }
    const list = virtualListRef.current
    if (document.activeElement !== document.body && !list?.contains(document.activeElement)) {
      setPendingFocusId(null)
      return
    }
    const id = CSS.escape(pendingFocusId)
    const element = list?.querySelector<HTMLElement>(`a[data-session-id="${id}"],button[data-navigation-id="${id}"]`)
    if (element) {
      element.focus({ preventScroll: true })
      setPendingFocusId(null)
    }
  }, [pendingFocusId, virtualItems])

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


  const toggleWorkspace = useCallback((id: string): void => {
    const next = new Set(expanded)
    if (next.has(id)) {
      next.delete(id)
      setGroups((previous) => {
        const copy = { ...previous }
        delete copy[id]

        return copy
      })
    } else {
      next.add(id)
    }
    setExpanded(next)
    try {
      localStorage.setItem(`${EXPANSION_STORAGE_PREFIX}${profile}`, JSON.stringify([...next]))
    } catch {
      // Expansion remains usable when browser persistence is blocked.
    }
  }, [expanded, profile])

  function handleListKeyDown(event: KeyboardEvent<HTMLUListElement>): void {
    const target = event.target
    if (!(target instanceof HTMLElement) || !target.matches('a[data-session-id],button[data-navigation-id]')) {
      return
    }
    const id = target.dataset['sessionId'] ?? target.dataset['navigationId']
    const currentIndex = rows.findIndex((row) => row.id === id)
    const next = getListNavigationIndex(event, { count: rows.length, currentIndex })
    if (next !== undefined && rows[next]) {
      event.preventDefault()
      setPendingFocusId(rows[next]!.id)
      rowVirtualizer.scrollToIndex(next, { align: 'auto' })
    }
  }

  const renameSession = useCallback((id: string, title: string): void => {
    if (title.trim()) {
      mutation.mutate({ id, changes: { title: title.trim() } })
    }
  }, [mutation.mutate])
  const pinSession = useCallback((id: string, pinned: boolean): void => {
    mutation.mutate({ id, changes: { is_pinned: !pinned } })
  }, [mutation.mutate])
  const deleteSession = useCallback((id: string): void => {
    mutation.mutate({ id }, { onSuccess: () => {
      if (id === viewedSessionId) {
        void navigate({ to: '/' })
      }
    } })
  }, [mutation.mutate, viewedSessionId, navigate])
  const pinWorkspace = useCallback((id: string, pinned: boolean): void => {
    workspaceMutation.mutate({ id, pinned: !pinned })
  }, [workspaceMutation.mutate])
  const deleteWorkspace = useCallback((id: string): void => {
    workspaceMutation.mutate({ id })
  }, [workspaceMutation.mutate])
  const newWorkspaceSession = useCallback((id: string): void => {
    void navigate({ to: '/', search: { workspace: id } })
  }, [navigate])
  const editWorkspace = useCallback((id: string): void => {
    const item = query.items.find((entry) => entry.kind === 'workspace' && entry.value.id === id)
    if (item?.kind === 'workspace') {
      setEditing(item.value)
    }
  }, [query.items])

  if (collapsed) {
    return null
  }

  return <nav className="session-list" aria-labelledby="session-list-title">
    <div className="session-list-heading">
      <h2 className="session-list-title" id="session-list-title">
        <button type="button" className="session-list-disclosure" aria-expanded={recentsExpanded} aria-controls="recents-items"
          onClick={() => {
            const next = !recentsExpanded
            setRecentsExpanded(next)
            try {
              localStorage.setItem(`${RECENTS_STORAGE_PREFIX}${profile}`, String(next))
            } catch {
              // Disclosure remains available when browser storage is blocked.
            }
          }}>
          Recents<Icon name="arrow-drop-right-line" />
        </button>
      </h2>
      <div className="session-list-heading-actions">
        <Button tone="muted" iconName="folder-add" tooltipMessage="New workspace" onClick={() => setEditing('new')} />
        <Button tone="muted" iconName="edit-box" tooltipMessage="New session" onClick={() => void navigate({ to: '/', search: {} })} />
      </div>
    </div>
    {openWorkspaces.map((item) =>
      <GroupLoader key={item.value.id} id={item.value.id} profile={profile} onPage={onPage} />)}
    <ul id="recents-items" hidden={!recentsExpanded} className="session-list-items" ref={virtualListRef} onKeyDown={handleListKeyDown}
      style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
      {virtualItems.map((virtualRow) => {
        const row = rows[virtualRow.index]
        if (!row) {
          return null
        }
        const offset = virtualRow.start - rowVirtualizer.options.scrollMargin
        if (row.kind === 'session') {
          const session = row.session

          return <SessionListItem key={row.id} id={session.id} title={session.title} isPinned={session.isPinned}
            workspaceId={session.workspaceId}
            isUnread={session.id !== viewedSessionId && Object.hasOwn(readState.unread, session.id)} status={session.status}
            timestamp={session.lastMessageAt ?? session.createdAt}
            relativeTime={formatRelativeDate(session.lastMessageAt ?? session.createdAt, now, 'compact')}
            isListScrolling={isListScrolling} onDelete={deleteSession} onRename={renameSession} onPin={pinSession}
            height={virtualRow.size} offset={offset} />
        }
        if (row.kind === 'more') {
          const group = groups[row.workspaceId]

          return <li key={row.id} className="workspace-more" style={{ height: virtualRow.size, transform: `translateY(${offset}px)` }}>
            <Button size="sm" data-navigation-id={row.id} disabled={!group || group.isFetching} onClick={() => {
              if (group?.isError) {
                void group.refetch()
              } else {
                void group?.fetchNextPage()
              }
            }}>{!group || group.isFetching ? 'Loading conversations…' : group.isError ? 'Retry loading conversations' : 'Show more'}</Button>
          </li>
        }
        const workspace = row.workspace
        const open = expanded.has(row.id)
        const hasUnread = Object.values(readState.workspaces).includes(row.id)
          || groups[row.id]?.sessions.some((session) => Object.hasOwn(readState.unread, session.id))

        return <SessionListItem key={row.id} id={row.id} rowKind="workspace" title={workspace.name}
          workspaceColor={workspace.color} expanded={open} isPinned={workspace.isPinned === true} isExplicitlyPinned={workspace.isExplicitlyPinned === true} isUnread={Boolean(hasUnread)}
          status={!open && workspace.runningSessionCount ? SessionStatus.Wip : SessionStatus.Idle}
          timestamp={workspace.lastActivityAt} relativeTime="" isListScrolling={isListScrolling}
          onPin={pinWorkspace} onToggle={toggleWorkspace} onNewSession={newWorkspaceSession} onEdit={editWorkspace}
          onDelete={deleteWorkspace} height={virtualRow.size} offset={offset} />
      })}
    </ul>
    {recentsExpanded && query.isPending && <Loader size="sm" label="Loading sessions…" />}
    {recentsExpanded && query.isError && <Button onClick={() => void query.refetch()}>Retry loading sessions</Button>}
    <div ref={scrollMaskRef} hidden={!recentsExpanded} className="session-list-mask" aria-hidden="true" />
    {editing && <WorkspaceDialog key={editing === 'new' ? 'new' : editing.id}
      {...(editing === 'new' ? {} : { workspace: editing })} onClose={() => setEditing(null)} />}
  </nav>
}
