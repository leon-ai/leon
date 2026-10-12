export interface WebResponse {
  status?: string
  error?: unknown
  usage?: { server_side_tool_usage_details?: { web_search_calls?: number } }
  output?: Array<{
    type: string
    status?: string
    url?: string
    title?: string
    httpStatus?: number
    action?: { type?: string, url?: string }
    content?: string | Array<{ type: string, text?: string, annotations?: Array<{ type: string, url?: string }> }>
  }>
}

/**
 * Compares fetch evidence with the requested page, ignoring fragment anchors.
 */
export function samePage(actual: string | undefined, expected: string): boolean {
  try {
    const actualURL = new URL(actual || '')
    const expectedURL = new URL(expected)
    actualURL.hash = ''
    expectedURL.hash = ''
    return actualURL.href === expectedURL.href
  } catch {
    return false
  }
}

/**
 * Requires a completed opening of the requested URL before returning model text.
 */
export function readFetchedSummary(data: WebResponse, url: string): string {
  if (data.error || data.status !== 'completed') {
    throw new Error('The provider did not complete the page-reading request. Use the browser tool instead.')
  }
  const opened = data.output?.some((item) =>
    item.type === 'web_search_call' && item.status === 'completed' &&
    ['open_page', 'browse_page'].includes(item.action?.type || '') &&
    samePage(item.action?.url, url)
  )
  if (!opened) {
    throw new Error('The provider returned no evidence of opening the requested URL. Use the browser tool instead.')
  }
  // A completed open_page can still represent a 404 or blocked page. Require
  // a provider citation as well, rather than guessing success from prose.
  const cited = data.output?.some((item) =>
    item.type === 'message' && Array.isArray(item.content) &&
    item.content.some((part) => part.type === 'output_text' &&
      part.annotations?.some((citation) =>
        citation.type === 'url_citation' && samePage(citation.url, url)
      )
    )
  )
  if (!cited) {
    throw new Error('The provider did not cite content from the requested page. Use the browser tool instead.')
  }
  const content = data.output?.flatMap((item) =>
    item.type === 'message' && Array.isArray(item.content)
      ? item.content.filter((part) => part.type === 'output_text').map((part) => part.text || '') : []
  ).join('\n').trim()
  if (!content) {
    throw new Error('The provider returned no page summary. Use the browser tool instead.')
  }
  return content
}
