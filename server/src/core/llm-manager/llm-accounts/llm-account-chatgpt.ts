import { createHash, randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'

import { createRemoteJWKSet, jwtVerify } from 'jose'

import { getRequiredLLMProviderAccountConfig } from '@/core/llm-manager/llm-provider-account-configs'
import { LEON_HOME_PATH } from '@/leon-roots'
import { getActiveProfileName, runWithProfileContext } from '@/core/profile-runtime/profile-context'
import { MODEL_ACCOUNT_STORE, useModelAccount, type LLMAccountSignIn } from './index'
import { getLLMModelCatalogEntries } from '../llm-model-catalog'
import { LLMProviders } from '../types'
import type { ConnectionSummary } from '@/core/connections/connection-store'

const ISSUER = 'https://auth.openai.com'
const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`
const AUTHORIZE_URL = `${ISSUER}/api/accounts/authorize`
const RESOURCE = getRequiredLLMProviderAccountConfig(LLMProviders.OpenAI).baseURL
const DYNAMIC_CLIENT = 'dynamic_agent_client'
const PLAN_SCOPE = 'chatgpt.tokens.use.direct'
const SCOPES = `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`
const CALLBACK_PATH = '/auth/callback'
const AUTH_TIMEOUT_MS = 600_000
const REQUEST_TIMEOUT_MS = 30_000
const HOST_ID_FILENAME = '.chatgpt-host-id'
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`))

interface OAuthToken {
  access_token: string
  refresh_token?: string
  id_token?: string
  expires_in: number
  scope?: string
}

async function exchange(
  parameters: Record<string, string>,
  signal?: AbortSignal
): Promise<OAuthToken> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...parameters, resource: RESOURCE }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: 'error'
  })

  if (!response.ok) {
    throw new Error('I could not connect your ChatGPT account. Please try again.')
  }

  const token = await response.json() as OAuthToken
  if (!token.access_token || !Number.isFinite(token.expires_in) || token.expires_in <= 0) {
    throw new Error('ChatGPT returned an incomplete authorization.')
  }

  return token
}

async function getHostID(): Promise<string> {
  const file = path.join(LEON_HOME_PATH, HOST_ID_FILENAME)

  await fs.mkdir(path.dirname(file), { recursive: true })
  try {
    await fs.writeFile(file, `urn:uuid:${randomUUID()}`, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error
    }
  }

  return (await fs.readFile(file, 'utf8')).trim()
}

/**
 * Fetch only models available to this account; prefer Leon's curated default.
 */
export async function getChatGPTModel(
  accessToken: string,
  preferred = '',
  signal?: AbortSignal
): Promise<string> {
  const response = await fetch(`${RESOURCE}/models`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: 'error'
  })
  if (!response.ok) {
    throw new Error('I could not check the models available to your ChatGPT account.')
  }

  const data = await response.json() as { models?: { slug: string, visibility: string }[] }
  const available = (data.models || []).filter((model) => model.visibility === 'list').map((model) => model.slug)
  const catalog = getLLMModelCatalogEntries(LLMProviders.OpenAI)
  const recommendation = catalog.find((entry) => entry.recommended)?.model
  const model = [preferred, recommendation, ...catalog.map((entry) => entry.model)]
    .find((candidate) => candidate && available.includes(candidate)) || available[0]

  if (!model) {
    throw new Error('Your ChatGPT account does not have an available model for me.')
  }

  return model
}

/**
 * Start Leon's own public-client OAuth consent flow on a loopback listener.
 * Fellow account tokens are never copied or exchanged on their behalf.
 */
export async function startChatGPTSignIn(accountID?: string, preferredModel = ''): Promise<LLMAccountSignIn> {
  const profileName = getActiveProfileName()
  const previous = accountID ? await MODEL_ACCOUNT_STORE.getCredentials(accountID, undefined, false, false) : null
  if (accountID && (!previous || previous['auth_kind'] !== 'chatgpt')) {
    throw new Error('I could not find that ChatGPT connection. Use /connection ai.')
  }

  const clientID = previous ? String(previous['client_id']) : DYNAMIC_CLIENT
  const hostID = previous ? String(previous['ext_agent_host_id']) : await getHostID()
  const state = randomBytes(32).toString('base64url')
  const nonce = randomBytes(32).toString('base64url')
  const verifier = randomBytes(32).toString('base64url')
  let resolve!: (summary: ConnectionSummary) => void
  let reject!: (error: Error) => void
  const complete = new Promise<ConnectionSummary>((success, failure) => {
    resolve = success
    reject = failure
  })
  // Callers may display the URL before waiting for completion.
  void complete.catch(() => undefined)
  let consumed = false
  const cancellation = new AbortController()
  const timer = setTimeout(() => cancel(), AUTH_TIMEOUT_MS)
  const cancel = (): void => {
    cancellation.abort()
    if (timer) {
      clearTimeout(timer)
    }
    server.close()
    reject(new Error('ChatGPT sign-in ended. Use /connection ai connect openai to try again.'))
  }

  const server = http.createServer((request, response) => {
    const callback = new URL(request.url || '/', 'http://127.0.0.1')

    if (request.method !== 'GET' || callback.pathname !== CALLBACK_PATH ||
      callback.searchParams.get('state') !== state || consumed) {
      response.writeHead(400).end('This sign-in request is not valid.')
      return
    }

    consumed = true
    const issuedID = callback.searchParams.get('client_id') ||
      (clientID !== DYNAMIC_CLIENT ? clientID : '')
    const code = callback.searchParams.get('code')

    if (callback.searchParams.has('error') || !code || !issuedID ||
      issuedID === DYNAMIC_CLIENT || (previous && issuedID !== clientID)) {
      response.writeHead(400).end('Sign-in was not completed. Return to Leon AI to try again.')
      cancel()
      return
    }

    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      .end('I received your sign-in. You can return to Leon AI now.')
    if (timer) {
      clearTimeout(timer)
    }
    server.close()

    void runWithProfileContext({ profileName }, async () => {
      const token = await exchange({
        grant_type: 'authorization_code',
        client_id: issuedID,
        code,
        code_verifier: verifier,
        redirect_uri: redirectURI
      }, cancellation.signal)
      cancellation.signal.throwIfAborted()
      if (!token.id_token) {
        throw new Error('ChatGPT did not return a verified account identity.')
      }
      const { payload } = await jwtVerify(token.id_token, JWKS, {
        issuer: ISSUER,
        audience: issuedID,
        algorithms: ['RS256'],
        requiredClaims: ['sub', 'exp', 'nonce']
      })
      const scopes = (token.scope || '').split(' ')
      if (payload['nonce'] !== nonce || !scopes.includes(PLAN_SCOPE) ||
        (previous && payload.sub !== previous['subject'])) {
        throw new Error('I need permission to use the selected ChatGPT account.')
      }

      cancellation.signal.throwIfAborted()
      const model = await getChatGPTModel(
        token.access_token,
        String(previous?.['model'] || preferredModel),
        cancellation.signal
      )
      // Verification and HTTP requests may finish after the owner cancels.
      cancellation.signal.throwIfAborted()
      const summary = await MODEL_ACCOUNT_STORE.save({
        provider: accountID || `openai.${randomUUID()}`,
        auth_type: 'oauth',
        account_label: `${String(payload['email'] || 'ChatGPT')} (${issuedID})`,
        scopes,
        credentials: {
          ...token,
          auth_kind: 'chatgpt',
          subject: payload.sub,
          client_id: issuedID,
          ext_agent_host_id: hostID,
          model,
          expires_at: Date.now() + token.expires_in * 1_000
        }
      })
      cancellation.signal.throwIfAborted()
      await useModelAccount(summary.provider, model)
      resolve(summary)
    }).catch(() => reject(new Error('I could not finish ChatGPT sign-in. Please try /connection ai connect openai again.')))
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
    throw new Error('I could not start the ChatGPT sign-in listener.')
  }
  const redirectURI = `http://127.0.0.1:${address.port}${CALLBACK_PATH}`
  const url = new URL(AUTHORIZE_URL)
  const parameters: Record<string, string> = {
    client_id: clientID,
    ext_agent_host_id: hostID,
    response_type: 'code',
    redirect_uri: redirectURI,
    scope: SCOPES,
    resource: RESOURCE,
    state,
    nonce,
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url')
  }
  if (!previous) {
    parameters['agent_name_hint'] = 'Leon AI'
  }
  // Avoid putting the retained ID token in displayable authorization URLs.
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, value)
  }
  return { url: url.toString(), complete, cancel }
}

/**
 * Renew a registration under the connection store's existing refresh lock.
 */
export async function refreshChatGPTAccount(
  credentials: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (credentials['auth_kind'] !== 'chatgpt' || !credentials['refresh_token'] || !credentials['client_id']) {
    throw new Error('Please reconnect your ChatGPT account.')
  }
  const token = await exchange({
    grant_type: 'refresh_token',
    client_id: String(credentials['client_id']),
    refresh_token: String(credentials['refresh_token'])
  })
  if (token.scope && !token.scope.split(' ').includes(PLAN_SCOPE)) {
    throw new Error('ChatGPT plan usage is no longer authorized.')
  }

  return {
    ...credentials,
    ...token,
    expires_at: Date.now() + token.expires_in * 1_000
  }
}
