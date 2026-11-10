import { lookup } from 'node:dns'
import { request as requestHTTP } from 'node:http'
import { request as requestHTTPS } from 'node:https'
import { isIP } from 'node:net'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import type { Readable } from 'node:stream'
import { MIMEType } from 'node:util'

import PACKAGE from '@@/package.json' with { type: 'json' }
import { NetworkHelper } from '@/helpers/network-helper'

const REQUEST_TIMEOUT_MS = 4_000
const MAXIMUM_REDIRECTS = 3
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const WEBSITE_USER_AGENT = `LeonAI (+${PACKAGE.homepage})`


export interface WebsiteResource {
  bytes: Buffer
  type: string
  url: string
  charset: string | null
}

interface FetchOptions {
  types: ReadonlySet<string>
  maximumBytes: number
  truncate?: boolean
  signal: AbortSignal
}

/**
 * Restricts both supplied URLs and discovered assets to ordinary public websites.
 */
export function getWebsiteURL(value: string, base?: string): URL | null {
  try {
    const url = new URL(value, base)
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port ||
      isIP(hostname) && !NetworkHelper.isPublicAddress(hostname)) {
      return null
    }

    url.hash = ''
    return url
  } catch {
    return null
  }
}

/**
 * Fetches bounded public resources without owner headers. DNS is validated and
 * pinned on every redirect, including cross-origin icon CDN destinations.
 */
export async function fetchWebsiteResource(url: URL, options: FetchOptions, redirects = 0): Promise<WebsiteResource | null> {
  if (!getWebsiteURL(url.href) || options.signal.aborted) {
    return null
  }

  const result = await new Promise<WebsiteResource | URL | null>((resolve) => {
    let settled = false
    let body: Readable | undefined
    const finish = (value: WebsiteResource | URL | null): void => {
      if (settled) {
        return
      }
      settled = true
      resolve(value)
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    const request = url.protocol === 'https:' ? requestHTTPS : requestHTTP
    const pending = request({
      hostname, port: url.protocol === 'https:' ? 443 : 80,
      path: `${url.pathname}${url.search}`, method: 'GET', signal: options.signal,
      headers: { Accept: Array.from(options.types).join(', '), 'Accept-Encoding': 'identity', 'User-Agent': WEBSITE_USER_AGENT },
      lookup: (host, dnsOptions, callback) => {
        lookup(host, { all: true }, (error, addresses) => {
          if (error || addresses.length === 0 || addresses.some(({ address }) => !NetworkHelper.isPublicAddress(address))) {
            callback(error ?? new Error('Website host is not public'), '', 4)
            return
          }
          if (dnsOptions.all) {
            callback(null, addresses)
          } else {
            callback(null, addresses[0]!.address, addresses[0]!.family)
          }
        })
      }
    }, (response) => {
      if (REDIRECT_STATUSES.has(response.statusCode ?? 0)) {
        const next = response.headers.location && redirects < MAXIMUM_REDIRECTS
          ? getWebsiteURL(response.headers.location, url.href) : null
        // Do not downgrade an encrypted request or let redirects bypass DNS checks.
        finish(next && !(url.protocol === 'https:' && next.protocol !== 'https:') ? next : null)
        pending.destroy()
        return
      }

      let mime: MIMEType
      try {
        mime = new MIMEType(String(response.headers['content-type'] ?? ''))
      } catch {
        finish(null)
        pending.destroy()
        return
      }
      const type = mime.essence
      if (response.statusCode !== 200 || !options.types.has(type) ||
        !options.truncate && Number(response.headers['content-length']) > options.maximumBytes) {
        finish(null)
        pending.destroy()
        return
      }

      const encoding = response.headers['content-encoding']
      const decoder = encoding === 'gzip' ? createGunzip()
        : encoding === 'br' ? createBrotliDecompress() : encoding === 'deflate' ? createInflate() : undefined
      body = decoder ? response.pipe(decoder) : response
      const chunks: Buffer[] = []
      let size = 0
      let wireSize = 0
      if (decoder) {
        response.on('data', (chunk: Buffer) => {
          wireSize += chunk.length
          if (wireSize > options.maximumBytes) {
            finish(null)
            pending.destroy()
          }
        })
      }
      const complete = (): void => finish(size > 0 ? {
        type, bytes: Buffer.concat(chunks), url: url.href, charset: mime.params.get('charset')
      } : null)
      body.on('data', (chunk: Buffer) => {
        const available = options.maximumBytes - size
        if (chunk.length > available) {
          if (options.truncate) {
            chunks.push(chunk.subarray(0, available))
            size += available
            complete()
          } else {
            finish(null)
          }
          pending.destroy()
          return
        }
        size += chunk.length
        chunks.push(chunk)
      })
      body.on('end', complete)
      body.on('error', () => {
        finish(null)
        pending.destroy()
      })
      body.on('close', () => {
        if (!settled) {
          finish(null)
          pending.destroy()
        }
      })
      response.on('error', () => finish(null))
      response.on('aborted', () => finish(null))
    })
    const timer = setTimeout(() => pending.destroy(new Error('Website request timed out')), REQUEST_TIMEOUT_MS)
    pending.on('error', () => finish(null))
    pending.on('close', () => {
      clearTimeout(timer)
      if (settled) {
        body?.destroy()
      } else if (!body) {
        finish(null)
      }
    })
    pending.end()
  })

  return result instanceof URL ? fetchWebsiteResource(result, options, redirects + 1) : result
}
