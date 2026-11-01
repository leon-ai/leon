import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent
} from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useVirtualizer } from '@tanstack/react-virtual'

import { Button } from '@/components/button'
import { Input } from '@/components/input'
import { ScrollList, SCROLL_LIST_MASK_HEIGHT_PX } from '@/components/scroll-list'
import {
  useSessions,
  type ConversationSession
} from '@/data/sessions'
import { useProfile } from '@/data/profile'
import { createSearchIndex, getSearchSegments, searchIndex } from '@/utils/search'
import { formatRelativeDate } from '@/utils/format-date'
import { getListNavigationIndex } from '@/utils/list-navigation'

import './search-sessions-dialog.sass'

interface SearchSessionsDialogProps {
  onSessionSelect?: () => void
}

const SEARCH_DEBOUNCE_MS = 300
const SEARCH_RESULT_ITEM_HEIGHT = 46
const SEARCH_RESULT_OVERSCAN = 6

function useDebouncedValue<TValue>(
  value: TValue,
  delayMs: number
): TValue {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedValue(value)
    }, delayMs)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [delayMs, value])

  return debouncedValue
}

function getSessionTimestamp(session: ConversationSession): number {
  return session.lastMessageAt ?? session.updatedAt
}

export function SearchSessionsDialog({
  onSessionSelect
}: SearchSessionsDialogProps) {
  const scrollElementRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const listId = useId()
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS)
  const sessionsQuery = useSessions(useProfile(), debouncedQuery)
  const sessions = sessionsQuery.sessions
  const activeIndex = sessions.findIndex((session) => session.id === activeId)
  const searchResults = useMemo(
    () => new Map(searchIndex(createSearchIndex(sessions, (session) => [session.title]), debouncedQuery)
      .map((result) => [result.item.id, result])),
    [debouncedQuery, sessions]
  )
  const rowVirtualizer = useVirtualizer({
    count: sessions.length,
    getItemKey: (index) => sessions[index]?.id ?? index,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => SEARCH_RESULT_ITEM_HEIGHT,
    overscan: SEARCH_RESULT_OVERSCAN,
    scrollPaddingStart: SCROLL_LIST_MASK_HEIGHT_PX,
    scrollPaddingEnd: SCROLL_LIST_MASK_HEIGHT_PX
  })
  const lastVisibleIndex = rowVirtualizer.getVirtualItems().at(-1)?.index ?? -1
  useEffect(() => {
    if (lastVisibleIndex >= sessions.length - SEARCH_RESULT_OVERSCAN &&
      sessionsQuery.hasNextPage && !sessionsQuery.isFetching && !sessionsQuery.isError) {
      void sessionsQuery.fetchNextPage()
    }
  }, [lastVisibleIndex, sessions.length, sessionsQuery.hasNextPage, sessionsQuery.isFetching,
    sessionsQuery.isError, sessionsQuery.fetchNextPage])

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void {
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return
    }
    if (event.key === 'Escape') {
      // The dialog owns closing. Suppress the search field's native clear action.
      event.preventDefault()
      return
    }
    // Never activate results belonging to a query still awaiting its debounce.
    if (query !== debouncedQuery) {
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const session = sessions[activeIndex < 0 ? 0 : activeIndex]
      if (session) {
        onSessionSelect?.()
        void navigate({ to: '/session/$sessionId', params: { sessionId: session.id } })
      }
      return
    }
    const next = getListNavigationIndex(event, { count: sessions.length, currentIndex: activeIndex })
    if (next !== undefined) {
      event.preventDefault()
      setActiveId(sessions[next]?.id ?? null)
      if (next >= 0) {
        rowVirtualizer.scrollToIndex(next, { align: 'auto' })
      }
    }
  }

  return (
    <div className="search-sessions-dialog">
      <Input
        ariaLabel="Search sessions"
        autoFocus
        iconName="search"
        placeholder="Search sessions..."
        size="large"
        type="search"
        role="combobox"
        aria-expanded={sessions.length > 0}
        aria-autocomplete="list"
        aria-busy={query !== debouncedQuery || sessionsQuery.isPending}
        aria-controls={listId}
        aria-activedescendant={activeIndex >= 0 && rowVirtualizer.getVirtualItems().some((row) => row.index === activeIndex)
          ? `${listId}-${activeId}` : undefined}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setActiveId(null)
        }}
        onBlur={() => setActiveId(null)}
        onKeyDown={handleKeyDown}
      />
      <ScrollList
        className="search-sessions-dialog-results"
        scrollRef={scrollElementRef}
        onPointerMove={() => setActiveId(null)}
      >
        {sessions.length > 0 ? (
          <ul
            className="search-sessions-dialog-list"
            id={listId}
            role="listbox"
            aria-label="Matching sessions"
            style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const session = sessions[virtualRow.index]

              if (session === undefined) {
                return null
              }

              const result = searchResults.get(session.id)
              const segments = result ? getSearchSegments(result) : [{ text: session.title, highlighted: false }]

              return (
                <li
                  className="search-sessions-dialog-item list-item-slot"
                  key={session.id}
                  role="presentation"
                  style={{
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`
                  }}
                >
                  <Link
                    id={`${listId}-${session.id}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={session.id === activeId}
                    data-highlighted={session.id === activeId || undefined}
                    to="/session/$sessionId"
                    params={{ sessionId: session.id }}
                    className="search-sessions-dialog-link"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={onSessionSelect}
                  >
                    <span className="search-sessions-dialog-title">
                      {segments.map((segment, segmentIndex) => (
                        <span
                          className={segment.highlighted
                            ? 'search-sessions-dialog-title-highlight'
                            : undefined}
                          key={`${segment.text}-${segmentIndex}`}
                        >
                          {segment.text}
                        </span>
                      ))}
                    </span>
                    <span className="search-sessions-dialog-date">
                      {formatRelativeDate(getSessionTimestamp(session))}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="search-sessions-dialog-empty">
            <p className="search-sessions-dialog-empty-text">
              {sessionsQuery.isPending ? 'Searching…' : sessionsQuery.isError
                ? sessionsQuery.error.message : 'No session found.'}
            </p>
            {sessionsQuery.isError ? (
              <Button onClick={() => void sessionsQuery.refetch()}>Retry search</Button>
            ) : <Button
              to="/"
              variant="primary"
              {...(onSessionSelect === undefined ? {} : { onClick: onSessionSelect })}
            >
              New session
            </Button>}
          </div>
        )}
      </ScrollList>
    </div>
  )
}
