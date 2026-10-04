import { createHash, randomBytes, randomUUID } from 'node:crypto'
import http from 'node:http'

import type { ConnectionSummary } from '@/core/connections/connection-store'
import {
  getActiveProfileName,
  runWithProfileContext
} from '@/core/profile-runtime/profile-context'
import { getRequiredLLMProviderAccountConfig } from '../llm-provider-account-configs'
import { getLLMModelCatalogEntries } from '../llm-model-catalog'
import { LLMProviders } from '../types'
import { MODEL_ACCOUNT_STORE, useModelAccount, type LLMAccountSignIn } from './index'

const PROVIDER_CONFIG = getRequiredLLMProviderAccountConfig(LLMProviders.OpenRouter)
const AUTHORIZE_URL = new URL('/auth', PROVIDER_CONFIG.baseURL).toString()
const CALLBACK_PATH = '/auth/callback'
const AUTH_TIMEOUT_MS = 600_000
const REQUEST_TIMEOUT_MS = 30_000

/**
 * Authorize Leon with OpenRouter PKCE. OpenRouter returns a dedicated API key,
 * which stays encrypted in the selected profile rather than the global .env.
 */
export async function startOpenRouterSignIn(
  accountID?: string,
  preferredModel = ''
): Promise<LLMAccountSignIn> {
  const profileName = getActiveProfileName()
  const previous = accountID
    ? await MODEL_ACCOUNT_STORE.getCredentials(accountID, undefined, false, false)
    : null

  if (accountID && (!previous || previous['auth_kind'] !== 'openrouter')) {
    throw new Error('I could not find that OpenRouter account. Use /connection ai.')
  }

  const state = randomBytes(32).toString('base64url')
  const verifier = randomBytes(32).toString('base64url')
  const cancellation = new AbortController()
  let resolve!: (summary: ConnectionSummary) => void
  let reject!: (error: Error) => void
  const complete: LLMAccountSignIn['complete'] = new Promise((success, failure) => {
    resolve = success
    reject = failure
  })
  void complete.catch(() => undefined)
  let consumed = false
  const timer = setTimeout(() => cancel(), AUTH_TIMEOUT_MS)
  const cancel = (): void => {
    cancellation.abort()
    clearTimeout(timer)
    server.close()
    reject(new Error('OpenRouter sign-in ended. Use /connection ai connect openrouter to try again.'))
  }

  const server = http.createServer((request, response) => {
    const callback = new URL(request.url || '/', 'http://127.0.0.1')

    if (
      request.method !== 'GET' || callback.pathname !== CALLBACK_PATH ||
      callback.searchParams.get('state') !== state || consumed
    ) {
      response.writeHead(400).end('This sign-in request is not valid.')
      return
    }

    consumed = true
    const code = callback.searchParams.get('code')
    if (!code || callback.searchParams.has('error')) {
      response.writeHead(400).end('Sign-in was not completed. Return to Leon AI to try again.')
      cancel()
      return
    }

    clearTimeout(timer)
    server.close()
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      .end('I received your sign-in. You can return to Leon AI now.')

    void runWithProfileContext({ profileName }, async () => {
      const exchange = await fetch(`${PROVIDER_CONFIG.baseURL}/auth/keys`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code,
          code_verifier: verifier,
          code_challenge_method: 'S256'
        }),
        signal: AbortSignal.any([
          cancellation.signal,
          AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        ]),
        redirect: 'error'
      })
      if (!exchange.ok) {
        throw new Error('OpenRouter did not accept this sign-in.')
      }

      const token = await exchange.json() as { key?: string }
      if (typeof token.key !== 'string' || !token.key.trim()) {
        throw new Error('OpenRouter did not return an API key.')
      }

      const entries = getLLMModelCatalogEntries(PROVIDER_CONFIG.value)
      const model = String(previous?.['model'] || preferredModel) ||
        (entries.find((entry) => entry.recommended) || entries[0])?.model
      if (!model) {
        throw new Error('I could not find an OpenRouter model.')
      }

      cancellation.signal.throwIfAborted()
      const account = await MODEL_ACCOUNT_STORE.save({
        provider: accountID || `${PROVIDER_CONFIG.value}.${randomUUID()}`,
        auth_type: 'api_key',
        account_label: `${PROVIDER_CONFIG.label} (account sign-in)`,
        credentials: { auth_kind: 'openrouter', api_key: token.key, model }
      })
      await useModelAccount(account.provider, model)
      resolve(account)
    }).catch(() => {
      reject(new Error(
        'I could not finish OpenRouter sign-in. Please try /connection ai connect openrouter again.'
      ))
    })
  })

  await new Promise<void>((ready, failure) => {
    server.once('error', (error) => {
      cancel()
      failure(error)
    })
    server.listen(0, '127.0.0.1', ready)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    cancel()
    throw new Error('I could not start the OpenRouter sign-in listener.')
  }

  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('callback_url', `http://127.0.0.1:${address.port}${CALLBACK_PATH}`)
  url.searchParams.set('state', state)
  url.searchParams.set('key_label', 'Leon AI')
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set(
    'code_challenge',
    createHash('sha256').update(verifier).digest('base64url')
  )

  return { url: url.toString(), complete, cancel }
}
