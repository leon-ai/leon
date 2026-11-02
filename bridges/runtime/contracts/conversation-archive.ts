export const DEFAULT_ARCHIVE_PAGE_CHARACTERS = 8_000
export const MAXIMUM_ARCHIVE_PAGE_CHARACTERS = 16_000

export interface ArchiveMessageReadOptions {
  offset?: number
  limit?: number
}

/**
 * Visible source text, paged by Unicode characters independently of trace payloads.
 */
export interface ArchiveMessagePage {
  sessionId: string
  messageId: string
  who: 'owner' | 'leon'
  sentAt: number
  text: string
  offset: number
  nextOffset: number | null
  totalCharacters: number
}

export interface ArchiveSessionReadOptions {
  cursor?: string
  limit?: number
  role?: 'owner' | 'leon' | 'both'
}

/**
 * Ordered visible source fragments sharing one bounded character budget.
 */
export interface ArchiveSessionPage {
  sessionId: string
  role: NonNullable<ArchiveSessionReadOptions['role']>
  nextCursor: string | null
  messages: ArchiveMessagePage[]
}

/**
 * Source discovery metadata without conversation bodies or provider state.
 */
export interface ArchiveSessionSummary {
  sessionId: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
}

export interface ArchiveSessionListPage {
  sessions: ArchiveSessionSummary[]
  nextCursor: string | null
}
