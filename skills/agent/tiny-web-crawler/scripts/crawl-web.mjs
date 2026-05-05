#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_MAX_PAGES = 8
const DEFAULT_MAX_DEPTH = 2
const DEFAULT_SAME_DOMAIN_LIMIT = 5
const DEFAULT_MAX_SEARCH_QUERIES = 3
const DEFAULT_FETCH_MAX_TEXT_CHARS = 6_000
const DEFAULT_FETCH_MAX_LINKS = 150
const STRONG_MATCH_SCORE = 8

function parseArgs(argv) {
  const args = {
    urls: [],
    query: '',
    maxPages: DEFAULT_MAX_PAGES,
    maxDepth: DEFAULT_MAX_DEPTH,
    sameDomainLimit: DEFAULT_SAME_DOMAIN_LIMIT,
    maxSearchQueries: DEFAULT_MAX_SEARCH_QUERIES
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]

    if ((arg === '--url' || arg === '--start-url') && next) {
      args.urls.push(next)
      i += 1
    } else if (arg === '--urls' && next) {
      args.urls.push(
        ...next
          .split(',')
          .map((url) => url.trim())
          .filter(Boolean)
      )
      i += 1
    } else if (arg === '--query' && next) {
      args.query = next
      i += 1
    } else if (arg === '--max-pages' && next) {
      args.maxPages = Number(next)
      i += 1
    } else if (arg === '--max-depth' && next) {
      args.maxDepth = Number(next)
      i += 1
    } else if (arg === '--same-domain-limit' && next) {
      args.sameDomainLimit = Number(next)
      i += 1
    } else if (arg === '--max-search-queries' && next) {
      args.maxSearchQueries = Number(next)
      i += 1
    }
  }

  return args
}

function normalizeUrl(url) {
  const parsedUrl = new URL(url)

  parsedUrl.hash = ''

  return parsedUrl.toString()
}

function getDomain(url) {
  return new URL(url).hostname.toLowerCase()
}

function getQueryTerms(query) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
}

function scoreLink(link, query, sourceUrl = '') {
  const primaryHaystack = `${link.url} ${link.text || ''}`.toLowerCase()
  const contextHaystack = `${link.context || ''}`.toLowerCase()
  const sourceDomain = sourceUrl ? getDomain(sourceUrl) : ''
  const linkDomain = getDomain(link.url)
  let score = 0

  for (const term of getQueryTerms(query)) {
    if (primaryHaystack.includes(term)) {
      score += 4
    }

    if (contextHaystack.includes(term)) {
      score += 1
    }
  }

  if (sourceDomain && sourceDomain === linkDomain && score > 0) {
    score += 2
  }

  return score
}

function runFetchPage(url, query) {
  const scriptPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'fetch-page.mjs'
  )
  const result = spawnSync(process.execPath, [
    scriptPath,
    '--url',
    url,
    '--query',
    query,
    '--mode',
    'summary',
    '--max-text-chars',
    String(DEFAULT_FETCH_MAX_TEXT_CHARS),
    '--max-links',
    String(DEFAULT_FETCH_MAX_LINKS)
  ], {
    encoding: 'utf8',
    maxBuffer: 8 * 1_024 * 1_024
  })
  const output = result.stdout || result.stderr || '{}'

  try {
    return JSON.parse(output)
  } catch {
    return {
      ok: false,
      url,
      error: output.trim() || `fetch-page exited with ${result.status}`
    }
  }
}

function enqueueRelevantLinks(queue, page, query, depth, args, visited) {
  if (depth >= args.maxDepth || !Array.isArray(page.links)) {
    return
  }

  const scoredLinks = page.links
    .map((link) => ({
      ...link,
      score: scoreLink(link, query, page.url)
    }))
    .filter((link) => link.score > 0)
    .sort((firstLink, secondLink) => secondLink.score - firstLink.score)

  for (const link of scoredLinks) {
    try {
      const normalizedUrl = normalizeUrl(link.url)

      if (visited.has(normalizedUrl)) {
        continue
      }

      queue.push({
        url: normalizedUrl,
        depth: depth + 1,
        via: page.url,
        linkText: link.text,
        linkScore: link.score
      })
    } catch {
      continue
    }
  }
}

function hasRelevantLinks(page, query) {
  return (
    Array.isArray(page.links) &&
    page.links.some((link) => scoreLink(link, query, page.url) > 0)
  )
}

function shouldStopEarly(page, query, depth, maxDepth) {
  return (
    page.ok === true &&
    Array.isArray(page.snippets) &&
    page.snippets.length > 0 &&
    Number(page.score || 0) >= STRONG_MATCH_SCORE &&
    (depth >= maxDepth || !hasRelevantLinks(page, query))
  )
}

async function crawl(args) {
  if (args.urls.length === 0) {
    throw new Error('Missing --url or --urls. Use web search first, then pass promising URLs here.')
  }

  if (!args.query) {
    throw new Error('Missing --query')
  }

  const visited = new Set()
  const perDomainCounts = new Map()
  const queue = args.urls.map((url) => ({
    url: normalizeUrl(url),
    depth: 0,
    via: null,
    linkText: '',
    linkScore: 0
  }))
  const pages = []
  const matches = []
  let stopReason = 'limit_reached'

  while (queue.length > 0 && pages.length < args.maxPages) {
    queue.sort((firstItem, secondItem) => secondItem.linkScore - firstItem.linkScore)

    const item = queue.shift()

    if (!item || visited.has(item.url)) {
      continue
    }

    const domain = getDomain(item.url)
    const domainCount = perDomainCounts.get(domain) || 0

    if (domainCount >= args.sameDomainLimit) {
      continue
    }

    visited.add(item.url)
    perDomainCounts.set(domain, domainCount + 1)

    const page = runFetchPage(item.url, args.query)
    const pageSummary = {
      url: page.url || item.url,
      status: page.status || null,
      ok: page.ok === true,
      title: page.title || '',
      depth: item.depth,
      via: item.via,
      linkText: item.linkText,
      score: Number(page.score || 0),
      textLength: Number(page.textLength || 0),
      chunk: page.chunk || null,
      rawTruncated: page.rawTruncated === true,
      snippets: Array.isArray(page.snippets) ? page.snippets : [],
      error: page.error || null
    }

    pages.push(pageSummary)

    if (pageSummary.snippets.length > 0) {
      matches.push(pageSummary)
    }

    if (shouldStopEarly(page, args.query, item.depth, args.maxDepth)) {
      stopReason = 'strong_match_found'
      break
    }

    enqueueRelevantLinks(queue, page, args.query, item.depth, args, visited)
  }

  if (queue.length === 0 && stopReason === 'limit_reached') {
    stopReason = 'queue_exhausted'
  }

  return {
    query: args.query,
    limits: {
      maxPages: args.maxPages,
      maxDepth: args.maxDepth,
      sameDomainLimit: args.sameDomainLimit,
      maxSearchQueries: args.maxSearchQueries
    },
    stopReason,
    pagesChecked: pages.length,
    pages,
    matches
  }
}

try {
  const result = await crawl(parseArgs(process.argv.slice(2)))

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
