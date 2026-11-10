import type {
  OAuthClientProvider, OAuthClientInformationContext, OAuthDiscoveryState, StoredOAuthClientInformation,
  StoredOAuthTokens, OAuthClientMetadata
} from '@modelcontextprotocol/client'

import { ConnectionStore } from '@/core/connections/connection-store'
import type { MCPSource } from '../tool-source'

export const MCP_CONNECTIONS = new ConnectionStore('mcp')

interface Credentials {
  client?: StoredOAuthClientInformation
  tokens?: StoredOAuthTokens
  discovery?: OAuthDiscoveryState
}

/**
 * Signals a missing owner grant without exposing a provider request or tokens.
 */
export class MCPAuthenticationRequired extends Error {
  constructor() {
    super('I need you to connect this MCP server in Settings → Tools and connections.')
  }
}

/**
 * Adapts the SDK's OAuth discovery and PKCE flow to encrypted profile storage.
 * Verifiers and browser attempts remain separate from reusable credentials.
 */
export class MCPAuth implements OAuthClientProvider {
  public readonly clientMetadataUrl?: string
  private verifier = ''
  private writes = Promise.resolve()
  private closed = false

  constructor(
    private readonly provider: string,
    private readonly profile: string,
    private readonly source: MCPSource,
    private data: Credentials,
    readonly redirectUrl: string,
    private readonly nonce: string,
    private readonly redirect?: (url: URL) => void
  ) {
    if (source.clientMetadataUrl) {
      this.clientMetadataUrl = source.clientMetadataUrl
    }
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Leon AI',
      client_uri: 'https://getleon.ai',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    }
  }

  state(): string {
    return this.nonce
  }

  clientInformation(context?: OAuthClientInformationContext): StoredOAuthClientInformation | undefined {
    const client = this.data.client

    return client && (!context || client.issuer === context.issuer) ? client :
      this.source.clientId ? { client_id: this.source.clientId, ...(context ? { issuer: context.issuer } : {}) } : undefined
  }

  async saveClientInformation(client: StoredOAuthClientInformation): Promise<void> {
    this.data.client = client
    await this.persist()
  }

  tokens(context?: OAuthClientInformationContext): StoredOAuthTokens | undefined {
    const tokens = this.data.tokens

    return !context || tokens?.issuer === context.issuer ? tokens : undefined
  }

  async saveTokens(tokens: StoredOAuthTokens): Promise<void> {
    this.data.tokens = tokens
    await this.persist()
  }

  redirectToAuthorization(url: URL): void {
    if (!this.redirect) {
      throw new MCPAuthenticationRequired()
    }
    const server = new URL(this.source.url)
    if (url.username || url.password || url.protocol !== 'https:' &&
      !(server.protocol === 'http:' && url.origin === server.origin)) {
      throw new Error('This sign-in destination is not permitted.')
    }
    this.redirect(url)
  }

  saveCodeVerifier(value: string): void {
    this.verifier = value
  }

  codeVerifier(): string {
    if (!this.verifier) {
      throw new Error('This sign-in attempt is no longer available.')
    }

    return this.verifier
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.data.discovery
  }

  async saveDiscoveryState(value: OAuthDiscoveryState): Promise<void> {
    this.data.discovery = value
    await this.persist()
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    if (scope === 'all') {
      this.data = {}
      this.verifier = ''
    } else if (scope === 'verifier') {
      this.verifier = ''
    } else {
      delete this.data[scope]
    }
    await this.persist()
  }

  private persist(): Promise<void> {
    const snapshot = structuredClone(this.data)
    this.writes = this.writes.catch(() => undefined).then(async () => {
      if (this.closed) {
        return
      }
      await MCP_CONNECTIONS.save({ provider: this.provider, auth_type: 'oauth',
        credentials: { oauth: snapshot, source: this.source, redirect_uri: this.redirectUrl } }, this.profile)
      if (!snapshot.tokens) {
        await MCP_CONNECTIONS.markNeedsAttention(this.provider, this.profile)
      }
    })

    return this.writes
  }

  /**
   * Drains writes before disconnect/removal and rejects late refresh persistence.
   */
  async dispose(): Promise<void> {
    this.closed = true
    this.verifier = ''
    await this.writes.catch(() => undefined)
  }
}

/**
 * Reads only this integration's encrypted grant; SDK transport owns refresh.
 */
export async function createMCPAuth(input: {
  id: string
  profile: string
  source: MCPSource
  redirectUri?: string
  state?: string
  redirect?: (url: URL) => void
}): Promise<MCPAuth> {
  const stored = await MCP_CONNECTIONS.getCredentials(input.id, input.profile, false, false)

  const matches = JSON.stringify(stored?.['source']) === JSON.stringify(input.source)

  return new MCPAuth(input.id, input.profile, input.source,
    (matches ? stored?.['oauth'] ?? {} : {}) as Credentials,
    input.redirectUri ?? String(stored?.['redirect_uri'] ?? 'http://127.0.0.1/api/v1/tools/oauth/callback'),
    input.state ?? '', input.redirect)
}
