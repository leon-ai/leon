import { isIP } from 'node:net'

import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

const TOOLKIT_ID = 'search_web'
const TOOL_ID = 'keenable'
const API_URL = 'https://api.keenable.ai/v1'
const DEFAULT_RESULTS = 5
const MAX_RESULTS = 10
const MAX_TITLE_CHARS = 300
const MAX_SNIPPET_CHARS = 1_200
const DEFAULT_PAGE_CHARS = 8_000
const MAX_PAGE_CHARS = 16_000
const INDEXED_ONLY = -1
const FORCE_LIVE = 0
const DIRECT_TIMEOUT_MS = 15_000
const LOCAL_HOST_SUFFIXES = ['localhost', 'local', 'internal', 'lan', 'home.arpa']

type FetchMode = 'indexed' | 'live'

interface ToolFailure {
  success: false
  error: string
  retryAfterSeconds?: number
}

interface SearchResult {
  title: string
  url: string
  snippet: string
  publishedAt?: string
}

interface SearchOptions {
  publishedAfter?: string
  publishedBefore?: string
}

interface FetchOptions {
  mode?: FetchMode
  maxChars?: number
}

interface FetchedPage {
  url: string
  title: string
  markdown: string
  source: FetchMode | 'unknown'
  truncated: boolean
  totalChars: number
  stale?: boolean
  publishedAt?: string
}

interface KeenablePage {
  url?: unknown
  title?: unknown
  content?: unknown
  error?: { code?: string }
  published_at?: unknown
  stale?: unknown
  total_chars?: number
  truncated?: unknown
  usage?: { sku?: string }
}

function isPublicationDate(value: unknown): boolean {
  if (typeof value !== 'string' || value.length !== 'YYYY-MM-DD'.length) {
    return false
  }

  const date = new Date(value)

  return Number.isFinite(date.getTime()) && date.toISOString().split('T')[0] === value
}

function parseWebUrl(value: unknown): URL | null {
  const url = typeof value === 'string' ? URL.parse(value) : null

  return url && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
    ? url
    : null
}

/**
 * Search Keenable using either the profile's own key or public access.
 */
export default class KeenableTool extends Tool {
  public readonly toolkit = TOOLKIT_ID
  public readonly toolName = TOOL_ID
  public readonly description = ToolkitConfig.load(TOOLKIT_ID, TOOL_ID).description

  /**
   * Return bounded source evidence for Leon to read or synthesize.
   */
  public async searchWeb(
    query: string,
    maxResults: number | null = null,
    options: SearchOptions = {}
  ): Promise<
    | { success: true, data: { results: SearchResult[] } }
    | ToolFailure
  > {
    const searchQuery = typeof query === 'string' ? query.trim() : ''
    // The worker serializes an omitted positional argument as null when options follow it.
    const resultLimit = maxResults ?? DEFAULT_RESULTS

    if (!searchQuery) {
      return { success: false, error: 'A search query is required.' }
    }

    if (!Number.isInteger(resultLimit) || resultLimit < 1 || resultLimit > MAX_RESULTS) {
      return { success: false, error: `Choose between 1 and ${MAX_RESULTS} results.` }
    }

    const { publishedAfter, publishedBefore } = options
    if (
      (publishedAfter !== undefined && !isPublicationDate(publishedAfter)) ||
      (publishedBefore !== undefined && !isPublicationDate(publishedBefore))
    ) {
      return { success: false, error: 'Use valid YYYY-MM-DD dates for publication filters.' }
    }

    // The date-only bounds include the entire day at either end of the window.
    if (publishedAfter && publishedBefore && publishedAfter > publishedBefore) {
      return { success: false, error: 'publishedAfter must be on or before publishedBefore.' }
    }

    const response = await this.request('search', {
      query: searchQuery,
      max_results: resultLimit,
      snippet_max_length: MAX_SNIPPET_CHARS,
      published_after: publishedAfter,
      published_before: publishedBefore
    })
    if (!response.success) {
      return response
    }

    const results: SearchResult[] = []
    const hits = response.results.slice(0, resultLimit) as Array<
      (Partial<Omit<SearchResult, 'publishedAt'>> & { published_at?: unknown }) | null
    >

    // Preserve provider ranking and only expose citeable web URLs to the agent.
    for (const item of hits) {
      const url = parseWebUrl(item?.url)
      if (!url) {
        continue
      }

      results.push({
        title: typeof item?.title === 'string' ? item.title.trim().slice(0, MAX_TITLE_CHARS) : '',
        url: url.href,
        snippet: typeof item?.snippet === 'string' ? item.snippet.trim().slice(0, MAX_SNIPPET_CHARS) : '',
        ...(typeof item?.published_at === 'string' && item.published_at
          ? { publishedAt: item.published_at } : {})
      })
    }

    return { success: true, data: { results } }
  }

  /**
   * Read bounded Markdown from an indexed copy or request a live public page.
   */
  public async fetchUrl(
    url: string,
    options: FetchOptions = {}
  ): Promise<{ success: true, data: FetchedPage } | ToolFailure> {
    const pageUrl = parseWebUrl(url)
    const hostname = pageUrl?.hostname ?? ''
    const host = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname
    const { mode = 'indexed', maxChars = DEFAULT_PAGE_CHARS } = options

    // Only send publicly named pages to the hosted reader.
    if (
      !pageUrl || !host.includes('.') || isIP(host) ||
      LOCAL_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
    ) {
      return { success: false, error: 'Use a public HTTP(S) URL without embedded credentials.' }
    }

    if (mode !== 'indexed' && mode !== 'live') {
      return { success: false, error: 'Choose indexed or live for the fetch mode.' }
    }

    if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > MAX_PAGE_CHARS) {
      return { success: false, error: `Choose between 1 and ${MAX_PAGE_CHARS} characters.` }
    }

    pageUrl.hash = ''
    const response = await this.request('fetch', {
      urls: [pageUrl.href],
      content: { max_chars: maxChars },
      retrieval: { max_age_hours: mode === 'live' ? FORCE_LIVE : INDEXED_ONLY }
    })
    if (!response.success) {
      return response
    }

    const page = response.results[0] as KeenablePage | null | undefined
    // Keenable can return HTTP 200 and report failure on the individual page.
    if (page?.error?.code === 'not_stored') {
      return { success: false, error: 'Keenable has no indexed copy of this page.' }
    }
    if (page?.error || typeof page?.content !== 'string' || !page.content.trim()) {
      return { success: false, error: 'Keenable did not return readable text for this page.' }
    }

    const markdown = page.content.slice(0, maxChars)
    const totalChars = typeof page.total_chars === 'number' && Number.isSafeInteger(page.total_chars)
      ? Math.max(page.total_chars, page.content.length) : page.content.length
    const sku = page.usage?.sku

    // A live request can return an older indexed copy if the publisher is unavailable.
    const fromIndex = mode === 'indexed' || page.stale === true || sku === 'fetch'
    const confirmedLive = sku === 'fetch.live' || (!response.keyed && page.stale === false)

    return {
      success: true,
      data: {
        url: parseWebUrl(page.url)?.href ?? pageUrl.href,
        title: typeof page.title === 'string' ? page.title.trim().slice(0, MAX_TITLE_CHARS) : '',
        markdown,
        source: fromIndex ? 'indexed' : confirmedLive ? 'live' : 'unknown',
        truncated: page.truncated === true || markdown.length < totalChars,
        totalChars,
        ...(typeof page.stale === 'boolean' ? { stale: page.stale } : {}),
        ...(typeof page.published_at === 'string' && page.published_at
          ? { publishedAt: page.published_at } : {})
      }
    }
  }

  /**
   * Keep profile credentials, request cancellation and quota handling consistent.
   */
  private async request(
    operation: 'search' | 'fetch',
    body: Record<string, unknown>
  ): Promise<{ success: true, results: unknown[], keyed: boolean } | ToolFailure> {
    const configuredKey = ToolkitConfig.loadToolSettings(TOOLKIT_ID, TOOL_ID)['KEENABLE_API_KEY']
    const apiKey = typeof configuredKey === 'string' ? configuredKey.trim() : ''
    const signal = this.executionContext?.signal ?? AbortSignal.timeout(DIRECT_TIMEOUT_MS)
    const response = await fetch(`${API_URL}/${operation}${apiKey ? '' : '/public'}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-API-Key': apiKey } : { 'X-Keenable-Title': 'Leon' })
      },
      body: JSON.stringify(body),
      redirect: 'error',
      signal
    })

    if (!response.ok) {
      await response.body?.cancel()

      if (response.status === 429) {
        const retryAfterSeconds = Number(response.headers.get('Retry-After'))
        const hasDelay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0

        return {
          success: false,
          error: hasDelay
            ? `Keenable's ${operation} limit was reached. Retry after ${retryAfterSeconds} seconds.`
            : `Keenable's ${operation} limit was reached. Try again later.`,
          ...(hasDelay ? { retryAfterSeconds } : {})
        }
      }

      return { success: false, error: `Keenable ${operation} failed (HTTP ${response.status}).` }
    }

    const payload = await response.json().catch(() => null) as { results?: unknown } | null
    signal.throwIfAborted()
    if (!Array.isArray(payload?.results)) {
      return { success: false, error: `Keenable returned an invalid ${operation} result.` }
    }

    return { success: true, results: payload.results, keyed: Boolean(apiKey) }
  }
}
