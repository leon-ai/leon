import { createHash, randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'

import { createRemoteJWKSet, jwtVerify } from 'jose'

import { CODEBASE_PATH } from '@/leon-roots'
import { LogHelper } from '@/helpers/log-helper'
import { getActiveProfileName, runWithProfileContext } from '@/core/profile-runtime/profile-context'
import { MODEL_ACCOUNT_STORE, useModelAccount, type LLMAccountSignIn } from './index'
import { serveChatGPTSignInPage } from './chatgpt-sign-in-page'
import { getLLMModelCatalogEntries } from '../llm-model-catalog'
import { LLMProviders } from '../types'
import type { ConnectionSummary } from '@/core/connections/connection-store'
import {
  CHATGPT_ACCOUNT_CLAIM,
  CHATGPT_CODEX_AUTH_FLOW,
  CHATGPT_CODEX_BASE_URL,
  CHATGPT_CODEX_CLIENT_ID,
  CHATGPT_ORIGINATOR,
  chatGPTAccountHeaders,
  requireChatGPTCodexAccount
} from './chatgpt-account-config'

const ISSUER = 'https://auth.openai.com'
const TOKEN_URL = `${ISSUER}/oauth/token`
const AUTHORIZE_URL = `${ISSUER}/oauth/authorize`
const SCOPES = 'openid profile email offline_access'
const CALLBACK_PORT = 1_455
const CALLBACK_PATH = '/auth/callback'
const AUTH_TIMEOUT_MS = 600_000
const REQUEST_TIMEOUT_MS = 30_000
const LOGO_PATH = path.join(CODEBASE_PATH, 'web-app', 'public', 'img', 'logo-for-dark-bg.svg')
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`))

enum ChatGPTSignInStage {
  Listener = 'callback listener setup',
  Authorization = 'browser authorization',
  TokenExchange = 'token exchange',
  IdentityVerification = 'identity verification',
  ModelDiscovery = 'model discovery',
  AccountSave = 'account storage',
  AccountSelection = 'account selection'
}

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
    body: new URLSearchParams(parameters),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: 'error'
  })

  if (!response.ok) {
    throw Object.assign(
      new Error('I could not connect your ChatGPT account. Please try again.'),
      { statusCode: response.status }
    )
  }

  const token = await response.json() as OAuthToken
  if (!token.access_token || !Number.isFinite(token.expires_in) || token.expires_in <= 0) {
    throw new Error('ChatGPT returned an incomplete authorization.')
  }

  return token
}

/**
 * Fetch only models available to this account; prefer Leon's curated default.
 */
export async function getChatGPTModel(
  accessToken: string,
  preferred = '',
  signal?: AbortSignal,
  chatGPTAccountID = ''
): Promise<string> {
  const manifest = JSON.parse(
    await fs.readFile(path.join(CODEBASE_PATH, 'package.json'), 'utf8')
  ) as { version: string }
  const url = new URL(`${CHATGPT_CODEX_BASE_URL}/models`)
  url.searchParams.set('client_version', manifest.version)

  const response = await fetch(url, {
    headers: chatGPTAccountHeaders({
      access_token: accessToken,
      chatgpt_account_id: chatGPTAccountID
    }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: 'error'
  })
  if (!response.ok) {
    throw Object.assign(
      new Error('I could not check the models available to your ChatGPT account.'),
      { statusCode: response.status }
    )
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
 * Authorize a ChatGPT subscription through Codex OAuth on a loopback listener.
 * Fellow account tokens are never copied or exchanged on their behalf.
 */
export async function startChatGPTSignIn(
  accountID?: string,
  preferredModel = ''
): Promise<LLMAccountSignIn> {
  const profileName = getActiveProfileName()
  const previous = accountID ? await MODEL_ACCOUNT_STORE.getCredentials(accountID, undefined, false, false) : null
  if (accountID && (!previous || previous['auth_kind'] !== 'chatgpt')) {
    throw new Error('I could not find that ChatGPT connection. Use /connection ai.')
  }

  const logo = (await fs.readFile(LOGO_PATH)).toString('base64')
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
  let settled = false
  let stage = ChatGPTSignInStage.Listener
  const cancellation = new AbortController()
  const fail = (detail: string): void => {
    if (settled) {
      return
    }

    settled = true
    const message = `I could not finish ChatGPT sign-in during ${stage}: ${detail} Use /connection ai connect ${accountID || 'openai'} to try again.`
    LogHelper.error(message)
    reject(new Error(message))
  }
  const timer = setTimeout(() => {
    cancel('Browser authorization timed out before Leon received the callback.')
  }, AUTH_TIMEOUT_MS)
  const cancel = (detail?: string): void => {
    if (settled) {
      return
    }

    cancellation.abort()
    if (timer) {
      clearTimeout(timer)
    }
    server.close()

    fail(detail || 'ChatGPT sign-in ended.')
  }

  const server = http.createServer((request, response) => {
    const callback = new URL(request.url || '/', 'http://127.0.0.1')

    if (request.method !== 'GET' || callback.pathname !== CALLBACK_PATH ||
      callback.searchParams.get('state') !== state || consumed) {
      serveChatGPTSignInPage(response, logo)
      return
    }

    consumed = true
    const code = callback.searchParams.get('code')

    if (callback.searchParams.has('error') || !code) {
      serveChatGPTSignInPage(response, logo)
      // Provider-supplied error descriptions can contain private data.
      cancel('OpenAI rejected browser authorization or returned no code.')
      return
    }

    serveChatGPTSignInPage(response, logo, complete)
    if (timer) {
      clearTimeout(timer)
    }
    server.close()

    void runWithProfileContext({ profileName }, async () => {
      stage = ChatGPTSignInStage.TokenExchange
      const token = await exchange({
        grant_type: 'authorization_code',
        client_id: CHATGPT_CODEX_CLIENT_ID,
        code,
        code_verifier: verifier,
        redirect_uri: redirectURI
      }, cancellation.signal)
      cancellation.signal.throwIfAborted()
      stage = ChatGPTSignInStage.IdentityVerification
      if (!token.id_token) {
        throw new Error('ChatGPT did not return a verified account identity.')
      }
      const { payload } = await jwtVerify(token.id_token, JWKS, {
        issuer: ISSUER,
        audience: CHATGPT_CODEX_CLIENT_ID,
        algorithms: ['RS256'],
        requiredClaims: ['sub', 'exp']
      })
      const scopes = (token.scope || SCOPES).split(' ')
      const account = payload[CHATGPT_ACCOUNT_CLAIM] as Record<string, unknown> | undefined
      const chatGPTAccountID = account?.['chatgpt_account_id']
      // Codex may omit nonce; verify it whenever the signed token includes one.
      if (typeof chatGPTAccountID !== 'string' || !chatGPTAccountID ||
        (payload['nonce'] !== undefined && payload['nonce'] !== nonce) ||
        (previous && payload.sub !== previous['subject'])) {
        throw new Error('I need permission to use the selected ChatGPT account.')
      }

      cancellation.signal.throwIfAborted()
      stage = ChatGPTSignInStage.ModelDiscovery
      const model = await getChatGPTModel(
        token.access_token,
        String(previous?.['model'] || preferredModel),
        cancellation.signal,
        chatGPTAccountID
      )
      // Verification and HTTP requests may finish after the owner cancels.
      cancellation.signal.throwIfAborted()
      stage = ChatGPTSignInStage.AccountSave
      const summary = await MODEL_ACCOUNT_STORE.save({
        provider: accountID || `openai.${randomUUID()}`,
        auth_type: 'oauth',
        account_label: String(payload['email'] || 'ChatGPT subscription'),
        scopes,
        credentials: {
          ...token,
          auth_kind: 'chatgpt',
          auth_flow: CHATGPT_CODEX_AUTH_FLOW,
          chatgpt_account_id: chatGPTAccountID,
          subject: payload.sub,
          client_id: CHATGPT_CODEX_CLIENT_ID,
          model,
          expires_at: Date.now() + token.expires_in * 1_000
        }
      })
      cancellation.signal.throwIfAborted()
      stage = ChatGPTSignInStage.AccountSelection
      await useModelAccount(summary.provider, model)
      settled = true
      resolve(summary)
    }).catch((error: unknown) => {
      const status = error && typeof error === 'object'
        ? (error as Record<string, unknown>)['statusCode']
        : undefined
      const detail = error instanceof Error && error.name === 'TimeoutError'
          ? `The request timed out after ${REQUEST_TIMEOUT_MS / 1_000} seconds.`
          : typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
            ? `OpenAI returned HTTP ${status}.`
            : 'The operation was rejected or could not be completed.'

      // Report only controlled stage/status details, never the raw OAuth error.
      fail(detail)
    })
  })

  await new Promise<void>((ready, failure) => {
    server.once('error', () => {
      const detail = 'The local callback listener could not be started.'
      cancel(detail)
      failure(new Error(detail))
    })
    server.listen(CALLBACK_PORT, '127.0.0.1', ready)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    cancel()
    throw new Error('I could not start the ChatGPT sign-in listener.')
  }
  const redirectURI = `http://127.0.0.1:${address.port}${CALLBACK_PATH}`
  const url = new URL(AUTHORIZE_URL)
  const parameters: Record<string, string> = {
    client_id: CHATGPT_CODEX_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectURI,
    scope: SCOPES,
    state,
    nonce,
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    originator: CHATGPT_ORIGINATOR,
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url')
  }
  // Avoid putting the retained ID token in displayable authorization URLs.
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, value)
  }

  stage = ChatGPTSignInStage.Authorization
  LogHelper.info(`ChatGPT sign-in is awaiting the browser callback for profile ${profileName}.`)

  return { url: url.toString(), complete, cancel }
}

/**
 * Renew the Codex grant under the connection store's existing refresh lock.
 */
export async function refreshChatGPTAccount(
  credentials: Record<string, unknown>
): Promise<Record<string, unknown>> {
  requireChatGPTCodexAccount(credentials)

  if (!credentials['refresh_token'] || credentials['client_id'] !== CHATGPT_CODEX_CLIENT_ID) {
    throw new Error('Please reconnect your ChatGPT account.')
  }
  const token = await exchange({
    grant_type: 'refresh_token',
    client_id: String(credentials['client_id']),
    refresh_token: String(credentials['refresh_token'])
  })

  return {
    ...credentials,
    ...token,
    expires_at: Date.now() + token.expires_in * 1_000
  }
}
