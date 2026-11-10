import { lookup } from 'node:dns'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { Readable, Transform } from 'node:stream'
import { isIP } from 'node:net'

import { NetworkHelper } from '@/helpers/network-helper'
import PACKAGE from '@@/package.json' with { type: 'json' }

const MAXIMUM_RESPONSE_BYTES = 16 * 1_024 * 1_024
const AUTHORIZATION_REQUEST_TIMEOUT_MS = 30_000
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Allows encrypted remote servers and explicit loopback development servers.
 * Credentials never belong in a server URL or its query string.
 */
export function getMCPURL(value: string): URL {
  const url = new URL(value)
  if (url.username || url.password || url.hash || url.search ||
    url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))) {
    throw new Error('Use an HTTPS MCP URL without credentials or query parameters. HTTP is allowed only on loopback.')
  }

  return url
}

/**
 * Pins validated DNS results to the actual socket. OAuth discovery cannot
 * redirect requests or credentials into a private network or another origin.
 */
export function createMCPFetch(server: URL): typeof fetch {
  return async (input, init): Promise<Response> => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    const local = LOOPBACK_HOSTS.has(server.hostname) && url.origin === server.origin
    const address = url.hostname.replace(/^\[|\]$/g, '')
    if (url.username || url.password ||
      url.protocol !== 'https:' && !(local && url.protocol === 'http:') ||
      isIP(address) && !(local ? NetworkHelper.isLoopbackAddress(address) : NetworkHelper.isPublicAddress(address))) {
      throw new Error('This MCP destination is not permitted.')
    }
    // Tool streams follow the host's advancing-progress/idle policy. Only OAuth
    // metadata and token requests need a separate bounded network deadline.
    const isToolEndpoint = url.origin === server.origin && url.pathname === server.pathname
    const signal = isToolEndpoint ? request.signal :
      AbortSignal.any([request.signal, AbortSignal.timeout(AUTHORIZATION_REQUEST_TIMEOUT_MS)])

    return new Promise<Response>((resolve, reject) => {
      const connect = url.protocol === 'https:' ? httpsRequest : httpRequest
      const pending = connect(url, {
        method: request.method,
        signal,
        headers: { ...Object.fromEntries(request.headers), 'accept-encoding': 'identity',
          'user-agent': `LeonAI (+${PACKAGE.homepage})` },
        lookup: (hostname, options, callback) => {
          lookup(hostname, { all: true }, (error, addresses) => {
            if (error || !addresses.length || addresses.some(({ address }) =>
              !(local ? NetworkHelper.isLoopbackAddress(address) : NetworkHelper.isPublicAddress(address)))) {
              callback(error ?? new Error('MCP destination is not public.'), '', 4)
            } else if (options.all) {
              callback(null, addresses)
            } else {
              callback(null, addresses[0]!.address, addresses[0]!.family)
            }
          })
        }
      }, (response) => {
        const headers = new Headers()
        for (const [key, value] of Object.entries(response.headers)) {
          if (value !== undefined) {
            headers.set(key, Array.isArray(value) ? value.join(', ') : value)
          }
        }
        let received = 0
        const bounded = new Transform({ transform(chunk: Buffer, _encoding, done): void {
          received += chunk.length
          done(received > MAXIMUM_RESPONSE_BYTES ? new Error('This MCP response is too large.') : null, chunk)
        } })
        response.on('error', (error) => bounded.destroy(error))
        response.pipe(bounded)
        bounded.on('close', () => response.destroy())
        const status = response.statusCode ?? 500
        const empty = request.method === 'HEAD' || [204, 205, 304].includes(status)
        if (empty) {
          response.resume()
        }
        resolve(new Response(empty ? null : Readable.toWeb(bounded) as ReadableStream<Uint8Array>, { status, headers }))
      })
      pending.on('error', reject)
      if (request.body) {
        Readable.fromWeb(request.body as never).on('error', (error) => pending.destroy(error)).pipe(pending)
      } else {
        pending.end()
      }
    })
  }
}
