import { setTimeout as delay } from 'node:timers/promises'
import type { ServerResponse } from 'node:http'

import { getOAuthCompletionPath, isDesktopOAuthReturn, isOAuthAuthorizationURL, OAUTH_ATTEMPT_TIMEOUT_MS } from '../../../bridges/runtime/contracts/oauth-popup'
import type { HostAPI } from './types.js'

type Outcome = 'connected' | 'failed' | 'closed'
const MAXIMUM_PENDING_ATTEMPTS = 16

/**
 * Relays a browser return to the waiting Desktop request across browser profiles.
 * Only the server's authenticated connection status can confirm a successful sign-in.
 */
export function createDesktopOAuth(openExternal: (url: string) => Promise<void>): {
  authorize: HostAPI
  complete: (url: URL, response: ServerResponse) => boolean
} {
  const attempts = new Map<string, { provider: string, finish: (outcome: Outcome) => void }>()

  return {
    async authorize(request, response, url, readBody): Promise<void> {
      if (request.method !== 'POST') {
        response.writeHead(405).end()
        return
      }
      const { id, provider, authorization_url: authorizationURL } = JSON.parse((await readBody(request, 32_768)).toString())
      if (response.destroyed) {
        return
      }
      const returnURL = new URL(getOAuthCompletionPath('v1'), url.origin)
      returnURL.searchParams.set('popup_id', typeof id === 'string' ? id : '')

      if (!isDesktopOAuthReturn(returnURL, 'v1') || typeof provider !== 'string' ||
        !provider || provider.length > 256 || typeof authorizationURL !== 'string' ||
        !isOAuthAuthorizationURL(authorizationURL)) {
        response.writeHead(400).end()
        return
      }
      if (attempts.has(id) || attempts.size >= MAXIMUM_PENDING_ATTEMPTS) {
        response.writeHead(409).end()
        return
      }

      const completion = Promise.withResolvers<Outcome>()
      const cancel = new AbortController()
      const close = (): void => completion.resolve('closed')
      response.once('close', close)
      attempts.set(id, { provider, finish: completion.resolve })

      try {
        // Register before opening the browser, including when sign-in is immediate.
        const waiting = Promise.race([
          completion.promise,
          delay(OAUTH_ATTEMPT_TIMEOUT_MS, 'closed' as const, { signal: cancel.signal, ref: false })
        ])
        const [, outcome] = await Promise.all([openExternal(authorizationURL), waiting])
        if (!response.destroyed) {
          response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
            .end(JSON.stringify({ outcome }))
        }
      } finally {
        cancel.abort()
        attempts.delete(id)
        response.off('close', close)
      }
    },
    complete(url, response): boolean {
      const id = url.searchParams.get('popup_id')
      const attempt = id ? attempts.get(id) : undefined
      const outcome = url.searchParams.get('connection_result')
      if (!id || !attempt || attempt.provider !== url.searchParams.get('provider') ||
        (outcome !== 'connected' && outcome !== 'failed')) {
        return false
      }

      attempts.delete(id)
      attempt.finish(outcome)
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': 'default-src \'none\'; frame-ancestors \'none\'; base-uri \'none\'',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff'
      }).end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Back to Leon</title><p>You can return to Leon and close this tab.</p></html>')

      return true
    }
  }
}
