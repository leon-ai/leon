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
import {
  sessionIndex,
  type ConversationSession
} from '@/data/sessions'

import './search-sessions-dialog.sass'

interface SearchSessionsDialogProps {
  onSessionSelect?: () => void
}

interface HighlightedTitleSegment {
  highlighted: boolean
  text: string
}

const SEARCH_DEBOUNCE_MS = 300
const SEARCH_RESULT_ITEM_HEIGHT = 46
const SEARCH_RESULT_OVERSCAN = 6
const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short'
})
const DATE_WITH_YEAR_FORMATTER = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric'
})

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

function getStartOfDay(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  ).getTime()
}

function formatSessionDate(timestamp: number): string {
  const now = Date.now()
  const elapsedMs = Math.max(0, now - timestamp)
  const nowDate = new Date(now)
  const date = new Date(timestamp)
  const todayStart = getStartOfDay(nowDate)
  const yesterdayStart = todayStart - DAY_MS

  if (timestamp >= todayStart) {
    if (elapsedMs < MINUTE_MS) {
      return 'Just now'
    }

    if (elapsedMs < HOUR_MS) {
      const minutes = Math.floor(elapsedMs / MINUTE_MS)

      return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
    }

    const hours = Math.floor(elapsedMs / HOUR_MS)

    return `${hours} hour${hours === 1 ? '' : 's'} ago`
  }

  if (timestamp >= yesterdayStart) {
    return 'Yesterday'
  }

  if (date.getFullYear() === nowDate.getFullYear()) {
    return DATE_FORMATTER.format(date)
  }

  return DATE_WITH_YEAR_FORMATTER.format(date)
}

function sortSessionsByLastMessage(
  sessions: ConversationSession[]
): ConversationSession[] {
  return [...sessions].sort((firstSession, secondSession) =>
    getSessionTimestamp(secondSession) - getSessionTimestamp(firstSession)
  )
}

function getHighlightedTitleSegments(
  title: string,
  query: string
): HighlightedTitleSegment[] {
  const normalizedQuery = query.trim().toLowerCase()

  if (normalizedQuery.length === 0) {
    return [{ highlighted: false, text: title }]
  }

  const normalizedTitle = title.toLowerCase()
  const segments: HighlightedTitleSegment[] = []
  let searchIndex = 0

  while (searchIndex < title.length) {
    const matchIndex = normalizedTitle.indexOf(normalizedQuery, searchIndex)

    if (matchIndex === -1) {
      segments.push({
        highlighted: false,
        text: title.slice(searchIndex)
      })
      break
    }

    if (matchIndex > searchIndex) {
      segments.push({
        highlighted: false,
        text: title.slice(searchIndex, matchIndex)
      })
    }

    segments.push({
      highlighted: true,
      text: title.slice(matchIndex, matchIndex + normalizedQuery.length)
    })
    searchIndex = matchIndex + normalizedQuery.length
  }

  return segments
}

export function SearchSessionsDialog({
  onSessionSelect
}: SearchSessionsDialogProps) {
  const scrollElementRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS)
  const searchResults = useMemo(() => {
    const normalizedQuery = debouncedQuery.trim().toLowerCase()
    const sessions = sortSessionsByLastMessage(sessionIndex.sessions)

    if (normalizedQuery.length === 0) {
      return sessions
    }

    return sessions.filter((session) =>
      session.title.toLowerCase().includes(normalizedQuery)
    )
  }, [debouncedQuery])
  const rowVirtualizer = useVirtualizer({
    count: searchResults.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => SEARCH_RESULT_ITEM_HEIGHT,
    overscan: SEARCH_RESULT_OVERSCAN
  })

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
      <div
        className="search-sessions-dialog-results"
        ref={scrollElementRef}
      >
        {searchResults.length > 0 ? (
          <ul
            className="search-sessions-dialog-list"
            style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const session = searchResults[virtualRow.index]

              if (session === undefined) {
                return null
              }

              return (
                <li
                  className="search-sessions-dialog-item"
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
                      {getHighlightedTitleSegments(
                        session.title,
                        debouncedQuery
                      ).map((segment, segmentIndex) => (
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
                      {formatSessionDate(getSessionTimestamp(session))}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="search-sessions-dialog-empty">
            <p className="search-sessions-dialog-empty-text">
              No session found.
            </p>
            <Button
              to="/"
              variant="primary"
              {...(onSessionSelect === undefined ? {} : { onClick: onSessionSelect })}
            >
              New session
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
