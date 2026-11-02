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
