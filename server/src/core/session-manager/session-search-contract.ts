export const MAXIMUM_SESSION_SEARCH_EXCERPT_CHARACTERS = 320

/**
 * Query-specific source text, separate from durable session metadata.
 */
export interface SessionSearchMatch {
  excerpt: string
}
