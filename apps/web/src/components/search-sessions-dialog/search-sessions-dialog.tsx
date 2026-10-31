import {
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { Link } from '@tanstack/react-router'
import { useVirtualizer } from '@tanstack/react-virtual'

import { Button } from '@/components/button'
import { Input } from '@/components/input'
import { ScrollList } from '@/components/scroll-list'
import {
  useSessions,
  type ConversationSession
} from '@/data/sessions'
import { useProfile } from '@/data/profile'
import { createSearchIndex, getSearchSegments, searchIndex } from '@/utils/search'
import { formatRelativeDate } from '@/utils/format-date'

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
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS)
  const sessionsQuery = useSessions(useProfile(), debouncedQuery)
  const sessions = sessionsQuery.sessions
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
    overscan: SEARCH_RESULT_OVERSCAN
  })
  const lastVisibleIndex = rowVirtualizer.getVirtualItems().at(-1)?.index ?? -1
  useEffect(() => {
    if (lastVisibleIndex >= sessions.length - SEARCH_RESULT_OVERSCAN &&
      sessionsQuery.hasNextPage && !sessionsQuery.isFetching && !sessionsQuery.isError) {
      void sessionsQuery.fetchNextPage()
    }
  }, [lastVisibleIndex, sessions.length, sessionsQuery.hasNextPage, sessionsQuery.isFetching,
    sessionsQuery.isError, sessionsQuery.fetchNextPage])

  return (
    <div className="search-sessions-dialog">
      <Input
        ariaLabel="Search sessions"
        autoFocus
        iconName="search"
        placeholder="Search sessions..."
        size="large"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <ScrollList
        className="search-sessions-dialog-results"
        scrollRef={scrollElementRef}
      >
        {sessions.length > 0 ? (
          <ul
            className="search-sessions-dialog-list"
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
                  style={{
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`
                  }}
                >
                  <Link
                    to="/session/$sessionId"
                    params={{ sessionId: session.id }}
                    className="search-sessions-dialog-link"
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
