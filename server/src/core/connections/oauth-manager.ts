import { createHash, randomBytes } from 'node:crypto'

import { TOOLKIT_REGISTRY } from '@/core'
import { getOAuthClientSettings } from './connection-catalog'
import type { ToolOAuthSchema } from '@/schemas/tool-schemas'

const OAUTH_STATE_LIFETIME_MS = 10 * 60 * 1_000
const TOKEN_REQUEST_TIMEOUT_MS = 30_000

interface PendingOAuth {
  provider: string
  profile_name: string
  client_id: string
  client_secret?: string
  redirect_uri: string
  return_url: string
  code_verifier?: string
  config: ToolOAuthSchema
  created_at: number
}

interface OAuthTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
}

function getProviderConfig(provider: string): ToolOAuthSchema {
  const config =
    TOOLKIT_REGISTRY.getConnectionTool(provider).connection.methods.oauth

  if (!config) {
    throw new Error(`OAuth is not declared by the tool "${provider}".`)
  }

  return config
}

async function exchangeToken(
  config: ToolOAuthSchema,
  clientId: string,
  clientSecret: string,
  parameters: Record<string, string>
): Promise<OAuthTokenResponse> {
  const headers: Record<string, string> = { accept: 'application/json' }
  const bodyParameters = { ...config.token_parameters, ...parameters }

  if (config.token_auth === 'basic') {
    headers['authorization'] =
      `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
  } else {
    bodyParameters['client_id'] = clientId
    if (config.token_auth === 'body') {
      bodyParameters['client_secret'] = clientSecret
    }
  }

  headers['content-type'] =
    config.token_format === 'json'
      ? 'application/json'
      : 'application/x-www-form-urlencoded'

  const response = await fetch(config.token_url, {
    method: 'POST',
    headers,
    body:
      config.token_format === 'json'
        ? JSON.stringify(bodyParameters)
        : new URLSearchParams(bodyParameters).toString(),
    signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
    redirect: 'error'
  })

  if (!response.ok) {
    throw new Error(`OAuth token exchange failed (${response.status}).`)
  }

  const token = (await response.json()) as OAuthTokenResponse

  if (typeof token.access_token !== 'string' || !token.access_token.trim()) {
    throw new Error(
      'The authorization response did not contain an access token.'
    )
  }

  return token
}

function tokenCredentials(token: OAuthTokenResponse): Record<string, unknown> {
  return {
    access_token: token.access_token,
    ...(token.refresh_token ? { refresh_token: token.refresh_token } : {}),
    ...(typeof token.expires_in === 'number' && token.expires_in > 0
      ? { expires_at: Date.now() + token.expires_in * 1_000 }
      : {}),
    ...(token.token_type ? { token_type: token.token_type } : {})
  }
}

function makeReturnURL(
  pending: PendingOAuth,
  result: 'connected' | 'failed'
): string {
  const url = new URL(pending.return_url)

  url.searchParams.set('connection_result', result)
  url.searchParams.set('provider', pending.provider)

  return url.toString()
}

/**
 * Runs OAuth using authentication declarations owned by installed tools.
 */
export class OAuthManager {
  private readonly pendingAuthorizations = new Map<string, PendingOAuth>()

  /**
   * Creates a one-time authorization URL bound to a profile and its client origin.
   */
  createAuthorization(input: {
    provider: string
    profileName: string
    clientId: string
    clientSecret?: string
    redirectUri: string
    returnURL: string
  }): { authorization_url: string, scopes: string[] } {
    const config = getProviderConfig(input.provider)

    if (!input.clientId.trim()) {
      throw new Error('An OAuth client ID is required.')
    }

    if (config.token_auth !== 'none' && !input.clientSecret?.trim()) {
      throw new Error('This tool requires an OAuth client secret.')
    }

    const now = Date.now()

    for (const [state, pending] of this.pendingAuthorizations) {
      if (now - pending.created_at > OAUTH_STATE_LIFETIME_MS) {
        this.pendingAuthorizations.delete(state)
      }
    }

    const state = randomBytes(32).toString('base64url')
    const pending: PendingOAuth = {
      provider: input.provider,
      profile_name: input.profileName,
      client_id: input.clientId.trim(),
      ...(input.clientSecret ? { client_secret: input.clientSecret } : {}),
      redirect_uri: input.redirectUri,
      return_url: input.returnURL,
      ...(config.uses_pkce
        ? { code_verifier: randomBytes(48).toString('base64url') }
        : {}),
      config,
      created_at: now
    }
    const url = new URL(config.authorization_url)
    const parameters: Record<string, string> = {
      ...config.authorization_parameters,
      client_id: pending.client_id,
      redirect_uri: pending.redirect_uri,
      response_type: 'code',
      state
    }

    if (config.scopes.length) {
      parameters['scope'] = config.scopes.join(' ')
    }

    if (pending.code_verifier) {
      parameters['code_challenge_method'] = 'S256'
      parameters['code_challenge'] = createHash('sha256')
        .update(pending.code_verifier)
        .digest('base64url')
    }

    url.search = new URLSearchParams(parameters).toString()
    this.pendingAuthorizations.set(state, pending)

    return { authorization_url: url.toString(), scopes: config.scopes }
  }

  /**
   * Consumes callback state before exchanging its code to prevent concurrent replay.
   */
  async completeAuthorization(input: {
    state: string
    code: string
  }): Promise<{ return_url: string }> {
    const pending = this.pendingAuthorizations.get(input.state)

    this.pendingAuthorizations.delete(input.state)
    if (!pending || Date.now() - pending.created_at > OAUTH_STATE_LIFETIME_MS) {
      throw new Error(
        'Your authorization request expired. Start again from the connection card.'
      )
    }

    try {
      const token = await exchangeToken(
        pending.config,
        pending.client_id,
        pending.client_secret || '',
        {
          grant_type: 'authorization_code',
          code: input.code,
          redirect_uri: pending.redirect_uri,
          ...(pending.code_verifier
            ? { code_verifier: pending.code_verifier }
            : {})
        }
      )
      const grantedScopes =
        token.scope?.split(' ').filter(Boolean) || pending.config.scopes

      if (
        pending.config.scopes.some((scope) => !grantedScopes.includes(scope))
      ) {
        throw new Error('The account did not grant the required permissions.')
      }

      const { saveConnection } = await import('./connection-service')

      await saveConnection(
        {
          provider: pending.provider,
          auth_type: 'oauth',
          credentials: {
            client_id: pending.client_id,
            ...(pending.client_secret
              ? { client_secret: pending.client_secret }
              : {}),
            ...tokenCredentials(token)
          },
          scopes: grantedScopes
        },
        pending.profile_name
      )

      return { return_url: makeReturnURL(pending, 'connected') }
    } catch {
      // Provider bodies can contain credentials. Return only the outcome to clients.
      return { return_url: makeReturnURL(pending, 'failed') }
    }
  }

  /**
   * Refreshes tokens only when the tool declares support for the refresh grant.
   */
  async refreshCredentials(
    provider: string,
    credentials: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const config = getProviderConfig(provider)

    if (!config.supports_refresh || !credentials['refresh_token']) {
      throw new Error(
        `Reconnect ${provider}; this connection cannot refresh its access token.`
      )
    }

    const client = await getOAuthClientSettings(provider)
    const token = await exchangeToken(
      config,
      client['client_id'] || '',
      client['client_secret'] || '',
      {
        grant_type: 'refresh_token',
        refresh_token: String(credentials['refresh_token'])
      }
    )
    const next = { ...credentials, ...tokenCredentials(token) }

    // Application credentials have their own encrypted record.
    delete next['client_id']
    delete next['client_secret']
    // A provider may return a non-expiring token; do not retain the previous deadline.
    if (!token.expires_in) {
      delete next['expires_at']
    }

    return next
  }

  /**
   * Consumes a denied authorization attempt without retaining credentials in memory.
   */
  cancelAuthorization(state: string): string | null {
    const pending = this.pendingAuthorizations.get(state)

    this.pendingAuthorizations.delete(state)

    return pending ? makeReturnURL(pending, 'failed') : null
  }
}

export const OAUTH_MANAGER = new OAuthManager()
