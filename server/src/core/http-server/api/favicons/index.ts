import type { FastifyPluginAsync } from 'fastify'
import type { DefaultTreeAdapterTypes } from 'parse5'

import type { APIOptions } from '@/core/http-server/http-server'
import { fetchWebsiteResource, getWebsiteURL, type WebsiteResource } from './website-fetch'

const MAXIMUM_CACHE_ENTRIES = 128
const MAXIMUM_PENDING_REQUESTS = 8
const MAXIMUM_QUEUED_REQUESTS = 64
const MAXIMUM_ICON_BYTES = 65_536
const MAXIMUM_HTML_BYTES = 131_072
const MAXIMUM_FAVICON_CANDIDATES = 3
const REQUEST_DEADLINE_MS = 8_000
const CACHE_TTL_MS = 86_400_000
const FAILURE_TTL_MS = 30_000
const IMAGE_TYPES = new Set(['image/x-icon', 'image/vnd.microsoft.icon', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml'])
const ICON_RELATIONS = ['icon', 'apple-touch-icon', 'apple-touch-icon-precomposed'] as const
const HTML_WHITESPACE = /[\t\n\f\r ]+/u

/**
 * Discovers website icons locally, sharing bounded caches and
 * connection limits without delegating browsing history to a favicon service.
 */
export const faviconsPlugin: FastifyPluginAsync<APIOptions> = async (fastify, options) => {
  const cache = new Map<string, { value: WebsiteResource | null, expiresAt: number }>()
  const pending = new Map<string, Promise<WebsiteResource | null>>()
  const queue: Array<() => void> = []
  const shutdown = new AbortController()
  let activeRequests = 0

  function remember(key: string, value: WebsiteResource | null): void {
    if (shutdown.signal.aborted) {
      return
    }
    if (cache.size >= MAXIMUM_CACHE_ENTRIES) {
      cache.delete(cache.keys().next().value!)
    }
    cache.set(key, { value, expiresAt: Date.now() + (value ? CACHE_TTL_MS : FAILURE_TTL_MS) })
  }

  async function cached(key: string, load: (signal: AbortSignal) => Promise<WebsiteResource | null>): Promise<WebsiteResource | null> {
    const entry = cache.get(key)
    if (entry && entry.expiresAt > Date.now()) {
      cache.delete(key)
      cache.set(key, entry)
      return entry.value
    }
    cache.delete(key)
    const existing = pending.get(key)
    if (existing) {
      return existing
    }
    if (shutdown.signal.aborted || pending.size >= MAXIMUM_PENDING_REQUESTS + MAXIMUM_QUEUED_REQUESTS) {
      return null
    }

    const signal = AbortSignal.any([shutdown.signal, AbortSignal.timeout(REQUEST_DEADLINE_MS)])
    // Bound the whole discovery workflow, including redirects and HTML fallback.
    const loading = new Promise<WebsiteResource | null>((resolve) => {
      const finish = (value: WebsiteResource | null): void => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      }
      const abort = (): void => finish(null)
      signal.addEventListener('abort', abort, { once: true })
      void load(signal).then((value) => finish(signal.aborted ? null : value), () => finish(null))
    }).then((value) => {
      remember(key, value)
      return value
    }).finally(() => pending.delete(key))
    pending.set(key, loading)
    return loading
  }

  async function request(url: URL, types: ReadonlySet<string>, maximumBytes: number, signal: AbortSignal, truncate = false): Promise<WebsiteResource | null> {
    if (signal.aborted) {
      return null
    }
    if (activeRequests >= MAXIMUM_PENDING_REQUESTS) {
      if (queue.length >= MAXIMUM_QUEUED_REQUESTS) {
        return null
      }
      const admitted = await new Promise<boolean>((resolve) => {
        const start = (): void => {
          signal.removeEventListener('abort', abort)
          resolve(true)
        }
        const abort = (): void => {
          const index = queue.indexOf(start)
          if (index >= 0) {
            queue.splice(index, 1)
          }
          resolve(false)
        }
        queue.push(start)
        signal.addEventListener('abort', abort, { once: true })
      })
      if (!admitted) {
        return null
      }
    } else {
      activeRequests++
    }

    try {
      return await fetchWebsiteResource(url, { types, maximumBytes, signal, truncate })
    } finally {
      const next = queue.shift()
      if (next) {
        next()
      } else {
        activeRequests--
      }
    }
  }

  async function discoverIcons(url: URL, signal: AbortSignal): Promise<string[]> {
    const resource = await request(url, HTML_TYPES, MAXIMUM_HTML_BYTES, signal, true)
    if (!resource) {
      return []
    }
    // Parse only the bounded HTML fallback; ordinary icon loads need no HTML engine.
    const { parse, defaultTreeAdapter } = await import('parse5')
    let decoder: TextDecoder
    try {
      decoder = new TextDecoder(resource.charset ?? undefined)
    } catch {
      decoder = new TextDecoder()
    }
    const pending: DefaultTreeAdapterTypes.Node[] = [parse(decoder.decode(resource.bytes))]
    const links: DefaultTreeAdapterTypes.Element[] = []
    let baseHref: string | undefined

    // Iterate rather than recurse so deeply nested external HTML cannot exhaust
    // the call stack. Template contents remain inert, just as they are in a browser.
    while (pending.length) {
      const node = pending.pop()!
      if (defaultTreeAdapter.isElementNode(node)) {
        if (node.tagName === 'base' && baseHref === undefined) {
          baseHref = node.attrs.find(({ name }) => name === 'href')?.value
        } else if (node.tagName === 'link') {
          links.push(node)
        }
      }
      if ('childNodes' in node) {
        for (let index = node.childNodes.length - 1; index >= 0; index--) {
          pending.push(node.childNodes[index]!)
        }
      }
    }

    // A base declaration also affects links appearing before it in the document.
    const baseURL = baseHref === undefined ? resource.url :
      getWebsiteURL(baseHref, resource.url)?.href ?? resource.url
    const candidates = new Set<string>()
    for (const relation of ICON_RELATIONS) {
      for (const link of links) {
        const rel = link.attrs.find(({ name }) => name === 'rel')?.value.toLowerCase().split(HTML_WHITESPACE)
        const href = link.attrs.find(({ name }) => name === 'href')?.value.trim()
        if (!rel?.includes(relation) || !href) {
          continue
        }
        const candidate = getWebsiteURL(href, baseURL)
        if (candidate) {
          candidates.add(candidate.href)
          if (candidates.size === MAXIMUM_FAVICON_CANDIDATES) {
            return [...candidates]
          }
        }
      }
    }
    return [...candidates]
  }

  function favicon(origin: URL): Promise<WebsiteResource | null> {
    return cached(`icon:${origin.origin}`, async (signal) => {
      const conventional = new URL('/favicon.ico', origin)
      const icon = await request(conventional, IMAGE_TYPES, MAXIMUM_ICON_BYTES, signal)
      if (icon) {
        return icon
      }
      if (signal.aborted) {
        return null
      }
      const candidates = await discoverIcons(origin, signal)
      for (const candidate of candidates) {
        const url = getWebsiteURL(candidate)
        if (!url || url.href === conventional.href || signal.aborted) {
          continue
        }
        const discovered = await request(url, IMAGE_TYPES, MAXIMUM_ICON_BYTES, signal)
        if (discovered) {
          return discovered
        }
      }
      return null
    })
  }

  fastify.get<{ Querystring: { origin: string } }>(`/api/${options.apiVersion}/favicons`, {
    schema: { querystring: {
      type: 'object', required: ['origin'], additionalProperties: false,
      properties: { origin: { type: 'string', maxLength: 2_048 } }
    } }
  }, async (incoming, reply) => {
    let origin: URL
    try {
      origin = new URL(incoming.query.origin)
    } catch {
      return reply.code(400).send()
    }
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.port ||
      origin.pathname !== '/' || origin.search || origin.hash) {
      return reply.code(400).send()
    }
    // Prefer encrypted icon requests even when the authored page uses HTTP.
    origin.protocol = 'https:'
    const icon = await favicon(origin)
    reply.header('Cache-Control', `private, max-age=${(icon ? CACHE_TTL_MS : FAILURE_TTL_MS) / 1_000}`)
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('Content-Security-Policy', 'default-src \'none\'; sandbox')
    return icon ? reply.type(icon.type).send(icon.bytes) : reply.code(404).send()
  })

  fastify.addHook('preClose', async () => {
    shutdown.abort()
  })
  fastify.addHook('onClose', async () => {
    await Promise.allSettled(pending.values())
    pending.clear()
    cache.clear()
  })
}
