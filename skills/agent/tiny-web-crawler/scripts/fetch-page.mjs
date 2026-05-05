#!/usr/bin/env node

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_RAW_CHARS = 500_000
const DEFAULT_MAX_TEXT_CHARS = 8_000
const DEFAULT_TEXT_PREVIEW_CHARS = 1_500
const DEFAULT_MAX_LINKS = 150
const DEFAULT_MODE = 'summary'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7815.2 Safari/537.36'
const REMOVED_BLOCK_TAGS = [
  'script',
  'style',
  'noscript',
  'svg',
  'canvas',
  'iframe',
  'form',
  'select',
  'button',
  'nav',
  'footer',
  'aside'
]

function parseArgs(argv) {
  const args = {
    url: '',
    query: '',
    mode: DEFAULT_MODE,
    includeText: false,
    offset: 0,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxRawChars: DEFAULT_MAX_RAW_CHARS,
    maxTextChars: DEFAULT_MAX_TEXT_CHARS,
    maxLinks: DEFAULT_MAX_LINKS
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]

    if (arg === '--url' && next) {
      args.url = next
      i += 1
    } else if (arg === '--query' && next) {
      args.query = next
      i += 1
    } else if (arg === '--mode' && next) {
      args.mode = next === 'full' ? 'full' : DEFAULT_MODE
      i += 1
    } else if (arg === '--include-text') {
      args.includeText = next !== 'false'

      if (next === 'true' || next === 'false') {
        i += 1
      }
    } else if (arg === '--offset' && next) {
      args.offset = Number(next)
      i += 1
    } else if (arg === '--timeout-ms' && next) {
      args.timeoutMs = Number(next)
      i += 1
    } else if (arg === '--max-raw-chars' && next) {
      args.maxRawChars = Number(next)
      i += 1
    } else if (arg === '--max-text-chars' && next) {
      args.maxTextChars = Number(next)
      i += 1
    } else if (arg === '--max-links' && next) {
      args.maxLinks = Number(next)
      i += 1
    }
  }

  return args
}

function getPositiveInteger(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_match, code) => {
      const charCode = Number(code)

      return Number.isFinite(charCode) ? String.fromCodePoint(charCode) : ''
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => {
      const charCode = Number.parseInt(code, 16)

      return Number.isFinite(charCode) ? String.fromCodePoint(charCode) : ''
    })
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim()
}

function removeBlockTag(html, tagName) {
  return html.replace(
    new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, 'gi'),
    ' '
  )
}

function stripHtml(html) {
  const cleanedHtml = REMOVED_BLOCK_TAGS.reduce(
    (result, tagName) => removeBlockTag(result, tagName),
    html
  )

  return normalizeWhitespace(
    decodeHtmlEntities(
      cleanedHtml
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<\/(p|div|section|article|header|footer|main|li|tr|h[1-6])>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
    )
  )
}

function extractTitle(html) {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)

  return titleMatch ? normalizeWhitespace(stripHtml(titleMatch[1])) : ''
}

function normalizeUrl(url) {
  const parsedUrl = new URL(url)

  parsedUrl.hash = ''

  return parsedUrl.toString()
}

function extractLinks(html, baseUrl, maxLinks) {
  const links = []
  const seen = new Map()
  const linkPattern = /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi

  for (const match of html.matchAll(linkPattern)) {
    const rawHref = match[1] || match[2] || match[3] || ''
    const label = normalizeWhitespace(stripHtml(match[4] || ''))
    const contextStart = Math.max(0, match.index - 800)
    const contextEnd = Math.min(html.length, match.index + match[0].length + 800)
    const context = normalizeWhitespace(
      stripHtml(html.slice(contextStart, contextEnd))
    )

    if (!rawHref || rawHref.startsWith('#')) {
      continue
    }

    try {
      const resolvedUrl = normalizeUrl(new URL(rawHref, baseUrl).toString())
      const parsedUrl = new URL(resolvedUrl)

      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        continue
      }

      const existingIndex = seen.get(resolvedUrl)

      if (typeof existingIndex === 'number') {
        const existingLink = links[existingIndex]

        existingLink.text = normalizeWhitespace(
          `${existingLink.text} ${label}`
        ).slice(0, 180)
        existingLink.context = normalizeWhitespace(
          `${existingLink.context} ${context}`
        ).slice(0, 600)
        continue
      }

      seen.set(resolvedUrl, links.length)
      links.push({
        url: resolvedUrl,
        text: label.slice(0, 180),
        context: context.slice(0, 600)
      })

      if (links.length >= maxLinks) {
        break
      }
    } catch {
      continue
    }
  }

  return links
}

function getQueryTerms(query) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function findSnippets(text, query, maxSnippets = 8) {
  const terms = getQueryTerms(query)

  if (terms.length === 0) {
    return []
  }

  const snippets = []
  const seen = new Set()

  for (const term of terms) {
    const pattern = new RegExp(escapeRegExp(term), 'ig')
    let match = pattern.exec(text)

    while (match && snippets.length < maxSnippets) {
      const start = Math.max(0, match.index - 180)
      const end = Math.min(text.length, match.index + term.length + 180)
      const snippet = normalizeWhitespace(text.slice(start, end))
      const key = snippet.toLowerCase()

      if (!seen.has(key)) {
        seen.add(key)
        snippets.push(snippet)
      }

      match = pattern.exec(text)
    }

    if (snippets.length >= maxSnippets) {
      break
    }
  }

  return snippets
}

function getTextChunk(text, offset, maxTextChars) {
  const safeOffset = Math.min(
    Math.max(0, getPositiveInteger(offset, 0)),
    text.length
  )
  const safeMaxTextChars = getPositiveInteger(
    maxTextChars,
    DEFAULT_MAX_TEXT_CHARS
  )
  const textChunk = text.slice(safeOffset, safeOffset + safeMaxTextChars)
  const nextOffset = safeOffset + textChunk.length
  const hasMore = nextOffset < text.length

  return {
    text: textChunk,
    offset: safeOffset,
    chars: textChunk.length,
    hasMore,
    nextOffset: hasMore ? nextOffset : null
  }
}

function scoreText(text, query) {
  const lowerText = text.toLowerCase()

  return getQueryTerms(query).reduce((score, term) => {
    const matches = lowerText.match(new RegExp(escapeRegExp(term), 'g'))

    return score + (matches ? matches.length : 0)
  }, 0)
}

async function readResponseText(response, maxRawChars) {
  const safeMaxRawChars = getPositiveInteger(
    maxRawChars,
    DEFAULT_MAX_RAW_CHARS
  )

  if (!response.body || typeof response.body.getReader !== 'function') {
    const raw = await response.text()

    return {
      raw: raw.slice(0, safeMaxRawChars),
      rawTruncated: raw.length > safeMaxRawChars
    }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let raw = ''
  let rawTruncated = false

  while (raw.length < safeMaxRawChars) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    raw += decoder.decode(value, { stream: true })

    if (raw.length >= safeMaxRawChars) {
      raw = raw.slice(0, safeMaxRawChars)
      rawTruncated = true
      await reader.cancel()
      break
    }
  }

  if (!rawTruncated) {
    raw += decoder.decode()
  }

  return {
    raw,
    rawTruncated
  }
}

async function fetchPage(args) {
  if (!args.url) {
    throw new Error('Missing --url')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs)

  try {
    const response = await fetch(args.url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5'
      }
    })
    const finalUrl = normalizeUrl(response.url || args.url)
    const contentType = response.headers.get('content-type') || ''
    const { raw, rawTruncated } = await readResponseText(
      response,
      args.maxRawChars
    )
    const isHtml = /html|xml/i.test(contentType) || /<html|<body|<a\s/i.test(raw)
    const readableText = isHtml ? stripHtml(raw) : normalizeWhitespace(raw)
    const chunk = getTextChunk(readableText, args.offset, args.maxTextChars)
    const title = isHtml ? extractTitle(raw) : ''
    const links = isHtml ? extractLinks(raw, finalUrl, args.maxLinks) : []
    const includeText = args.mode === 'full' || args.includeText
    const result = {
      ok: response.ok,
      status: response.status,
      url: finalUrl,
      contentType,
      title,
      mode: args.mode,
      rawTruncated,
      textLength: readableText.length,
      chunk: {
        offset: chunk.offset,
        chars: chunk.chars,
        hasMore: chunk.hasMore,
        nextOffset: chunk.nextOffset
      },
      score: args.query ? scoreText(`${title} ${readableText}`, args.query) : 0,
      snippets: args.query ? findSnippets(readableText, args.query) : [],
      links
    }

    if (includeText) {
      result.text = chunk.text
    } else {
      result.textPreview = chunk.text.slice(0, DEFAULT_TEXT_PREVIEW_CHARS)
    }

    return result
  } finally {
    clearTimeout(timeout)
  }
}

try {
  const result = await fetchPage(parseArgs(process.argv.slice(2)))

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} catch (error) {
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      },
      null,
      2
    )}\n`
  )
  process.exitCode = 1
}
