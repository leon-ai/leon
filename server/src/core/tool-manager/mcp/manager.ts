import { createHash, randomBytes } from 'node:crypto'
import type { Client, StreamableHTTPClientTransport, Tool } from '@modelcontextprotocol/client'

import { getActiveProfileName, runWithProfileContext } from '@/core/profile-runtime/profile-context'
import { createProfileServiceProxy } from '@/core/profile-runtime/profile-runtime-manager'
import { MAX_TOOL_TIMEOUT_MS, type ToolRuntimeProgress, type ToolRuntimeResult, type ToolTimeoutPolicy } from '@@/bridges/runtime/contracts/tool-runtime-types'
import { ToolTimeout } from '@@/bridges/runtime/nodejs/tool-timeout'
import type { MCPFunction, MCPManifest } from '../tool-source'
import { createMCPAuth, MCPAuthenticationRequired, MCP_CONNECTIONS, type MCPAuth } from './auth'
import { createMCPFetch, getMCPURL } from './http'
import { saveMCPCache } from './installations'
import PACKAGE from '@@/package.json' with { type: 'json' }
import { getConnectionCallbackURL } from '@/core/connections/connection-catalog'
import { runTurnPhase, TurnPhase } from '@/core/llm-manager/turn-timing'

const DISCOVERY_TIMEOUT_MS = 30_000
const CALL_IDLE_TIMEOUT_MS = 60_000
const CONNECTION_IDLE_MS = 120_000
const MAXIMUM_CONNECTIONS = 16
const MAXIMUM_REMOTE_TOOLS = 256
const MAXIMUM_FUNCTION_CHARACTERS = 32_768
const FUNCTION_ALIAS_UNSAFE = /[^a-zA-Z0-9_-]/g
const AUTHORIZATION_LIFETIME_MS = 10 * 60_000
const MAXIMUM_AUTHORIZATIONS = 128

interface Connection {
  key: string
  client: Client
  transport: StreamableHTTPClientTransport
  active: number
  auth: MCPAuth
  closed: boolean
  operations: Set<Promise<unknown>>
  timer?: ReturnType<typeof setTimeout>
}

interface ConnectionEntry {
  pending: Promise<Connection>
  connected: boolean
}

interface Authorization {
  profile: string
  manifest: MCPManifest
  transport: StreamableHTTPClientTransport
  client: Client
  auth: MCPAuth
  returnURL: string
  expires: number
  consumed: boolean
  timer: ReturnType<typeof setTimeout>
}

// The callback is public, so only this bounded, one-time state map may select
// its profile. Neither a browser parameter nor a cookie can change ownership.
const authorizations = new Map<string, Authorization>()

function functionsFor(tools: Tool[]): Record<string, MCPFunction> {
  if (tools.length > MAXIMUM_REMOTE_TOOLS) {
    throw new Error('This server exposes too many tools. Choose a narrower MCP endpoint.')
  }
  return Object.fromEntries([...tools].sort((a, b) => a.name.localeCompare(b.name)).map((tool) => {
    if (JSON.stringify(tool).length > MAXIMUM_FUNCTION_CHARACTERS) {
      throw new Error('An MCP function schema is too large.')
    }
    const alias = `${tool.name.replace(FUNCTION_ALIAS_UNSAFE, '_').slice(0, 40)}_${createHash('sha256').update(tool.name).digest('hex').slice(0, 8)}`

    return [alias, { remote_name: tool.name,
      description: `${tool.name}: ${tool.description ?? tool.title ?? 'Remote tool'}`.slice(0, 256),
      parameters: tool.inputSchema as Record<string, unknown>,
      ...(tool.outputSchema ? { output_schema: tool.outputSchema as Record<string, unknown> } : {}) }]
  }))
}

/**
 * Owns lazily opened, profile-scoped transports. Request cancellation never
 * closes a shared client used by another concurrent conversation.
 */
export class MCPManager {
  private readonly profile = getActiveProfileName()
  private readonly connections = new Map<string, ConnectionEntry>()

  private open(manifest: MCPManifest): ConnectionEntry {
    const id = `${manifest.toolkit_id}.${manifest.tool_id}`
    const key = JSON.stringify([id, manifest.source])
    let entry = this.connections.get(key)
    if (!entry) {
      if (this.connections.size >= MAXIMUM_CONNECTIONS) {
        throw new Error('Too many MCP servers are active. Disable a server before connecting another.')
      }
      const pending = (async (): Promise<Connection> => {
        const sdk = await import('@modelcontextprotocol/client')
        const auth = await createMCPAuth({ id, profile: this.profile, source: manifest.source })
        const server = getMCPURL(manifest.source.url)
        const transport = new sdk.StreamableHTTPClientTransport(server, {
          authProvider: auth, fetch: createMCPFetch(server), onInsufficientScope: 'throw',
          reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1_000, maxReconnectionDelay: 1_000, reconnectionDelayGrowFactor: 1 }
        })
        const lifecycle: { connection?: Connection } = {}
        const client = new sdk.Client({ name: 'Leon AI', version: PACKAGE.version }, {
          listMaxPages: 4,
          listChanged: { tools: { onChanged: (error, tools): void => {
            const connection = lifecycle.connection
            if (!error && tools && connection && !connection.closed) {
              const operations = connection.operations
              const update = runWithProfileContext({ profileName: this.profile }, async () => {
                const functions = functionsFor(tools)
                await saveMCPCache(manifest, functions, Boolean(auth.tokens()))
                const { TOOLKIT_REGISTRY } = await import('@/core')
                TOOLKIT_REGISTRY.updateMCPFunctions(manifest.toolkit_id, manifest.tool_id, manifest.source, functions)
              }).catch(() => undefined)
              operations.add(update)
              void update.finally(() => operations.delete(update))
            }
          } } }
        })
        try {
          await client.connect(transport, { timeout: DISCOVERY_TIMEOUT_MS })
        } catch (error) {
          await auth.dispose()
          await client.close().catch(() => undefined)
          if (error instanceof sdk.UnauthorizedError || error instanceof MCPAuthenticationRequired) {
            throw new MCPAuthenticationRequired()
          }
          throw new Error('I could not connect to this MCP server. Check its address and availability.')
        }

        const connection: Connection = { key, client, transport, auth, active: 1, closed: false, operations: new Set() }
        entry!.connected = true
        lifecycle.connection = connection
        const opened = connection
        // A caller may cancel while the shared connection is opening. Idle
        // ownership starts here so that abandoned handshakes still get closed.
        this.release(connection)
        client.onclose = (): void => {
          if (this.connections.get(key) === entry) {
            this.connections.delete(key)
          }
          opened.closed = true
          clearTimeout(opened.timer)
          void auth.dispose()
        }

        return connection
      })()
      entry = { pending, connected: false }
      this.connections.set(key, entry)
      void pending.catch(() => {
        if (this.connections.get(key) === entry) {
          this.connections.delete(key)
        }
      })
    }

    return entry
  }

  private release(connection: Connection): void {
    connection.active -= 1
    if (!connection.active && !connection.closed) {
      connection.timer = setTimeout(() => {
        this.connections.delete(connection.key)
        void this.retire(connection)
      }, CONNECTION_IDLE_MS)
      connection.timer.unref()
    }
  }

  private async retire(connection: Connection): Promise<void> {
    connection.closed = true
    clearTimeout(connection.timer)
    await connection.auth.dispose()
    await connection.client.close().catch(() => undefined)
    // Cache and token writes must settle before management removes either file.
    await Promise.allSettled(connection.operations)
  }

  private async use<T>(manifest: MCPManifest, execute: (connection: Connection) => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    const entry = this.open(manifest)
    const pending = entry.pending
    let cancel: (() => void) | undefined
    const wait = (): Promise<Connection> => signal ? Promise.race([pending, new Promise<never>((_resolve, reject) => {
      cancel = (): void => reject(signal.reason)
      signal.addEventListener('abort', cancel, { once: true })
      if (signal.aborted) {
        cancel()
      }
    })]).finally(() => {
      if (cancel) {
        signal.removeEventListener('abort', cancel)
      }
    }) : pending
    // Each turn owns its wait interval, but cancellation must not abort another
    // turn's shared handshake. Reusing a ready client creates no connection row.
    const connection = await (entry.connected ? wait()
      : runTurnPhase(TurnPhase.MCPConnection, wait, { subject: manifest.name }))
    signal?.throwIfAborted()
    if (connection.closed) {
      throw new Error('This MCP connection was closed. Please try again.')
    }
    clearTimeout(connection.timer)
    connection.active += 1
    const operation = execute(connection)
    connection.operations.add(operation)
    try {
      return await operation
    } finally {
      connection.operations.delete(operation)
      this.release(connection)
    }
  }

  /**
   * Refreshes bounded schemas on explicit selection, never on application startup.
   */
  public async discover(manifest: MCPManifest): Promise<Record<string, MCPFunction>> {
    return this.use(manifest, ({ client }) => runTurnPhase(TurnPhase.MCPDiscovery, async () => {
      const { tools } = await client.listTools(undefined, { timeout: DISCOVERY_TIMEOUT_MS, cacheMode: 'refresh' })
      const functions = functionsFor(tools)
      const credentials = await MCP_CONNECTIONS.getCredentials(`${manifest.toolkit_id}.${manifest.tool_id}`, this.profile, false, false)
      await saveMCPCache(manifest, functions, Boolean((credentials?.['oauth'] as { tokens?: unknown } | undefined)?.tokens))

      return functions
    }, { subject: manifest.name }))
  }

  /**
   * Maps remote outcomes into the same host execution contract as native workers.
   * Provider hints never grant permissions or authorize automatic write retries.
   */
  public async call(manifest: MCPManifest, name: string, args: Record<string, unknown>, options: {
    signal?: AbortSignal
    onProgress?: (progress: ToolRuntimeProgress) => void
    timeout?: ToolTimeoutPolicy
  }): Promise<ToolRuntimeResult> {
    const timeout = new ToolTimeout({ idleMs: CALL_IDLE_TIMEOUT_MS, ...options.timeout })
    const signal = AbortSignal.any([timeout.signal, ...(options.signal ? [options.signal] : [])])
    try {
      return await this.use(manifest, async ({ client }) => {
        let previousProgress = -1
        const result = await client.callTool({ name, arguments: args }, {
          signal,
          timeout: MAX_TOOL_TIMEOUT_MS,
          onprogress: (progress) => {
            const advancing = progress.progress > previousProgress
            if (advancing) {
              timeout.touch()
            }
            previousProgress = Math.max(previousProgress, progress.progress)
            options.onProgress?.({
              source: 'report',
              message: String(progress.message ?? 'Working…').slice(0, 512),
              activity: advancing,
              data: {
                completed: progress.progress,
                ...(progress.total === undefined ? {} : { total: progress.total })
              }
            })
          }
        })
        const modelFiles = result.content.flatMap((item) => item.type === 'image' || item.type === 'audio'
          ? [{ dataBase64: item.data, mediaType: item.mimeType }] : [])
        const content = result.content.map((item) => item.type === 'image' || item.type === 'audio'
          ? { type: item.type, mimeType: item.mimeType, suppliedToModel: true } : item)

        return {
          success: !result.isError,
          message: result.isError ? 'The MCP server reported a tool failure.' : 'MCP tool completed.',
          output: {
            result: {
              content,
              ...(result.structuredContent === undefined ? {} : { structuredContent: result.structuredContent })
            }
          },
          ...(modelFiles.length ? { modelFiles } : {})
        }
      }, signal)
    } catch (error) {
      const { UnauthorizedError, InsufficientScopeError } = await import('@modelcontextprotocol/client')
      if (error instanceof UnauthorizedError || error instanceof InsufficientScopeError) {
        await MCP_CONNECTIONS.markNeedsAttention(`${manifest.toolkit_id}.${manifest.tool_id}`, this.profile)
        throw new MCPAuthenticationRequired()
      }
      throw error
    } finally {
      timeout.dispose()
    }
  }

  /**
   * Ends only the selected integration's clients after an explicit owner action.
   */
  public async close(id: string): Promise<void> {
    for (const [key, entry] of this.connections) {
      if ((JSON.parse(key) as string[])[0] !== id) {
        continue
      }
      this.connections.delete(key)
      const connection = await entry.pending.catch(() => undefined)
      if (connection) {
        await this.retire(connection)
      }
    }
    for (const [state, pending] of authorizations) {
      if (pending.profile === this.profile && `${pending.manifest.toolkit_id}.${pending.manifest.tool_id}` === id) {
        authorizations.delete(state)
        clearTimeout(pending.timer)
        await pending.auth.dispose()
        await pending.client.close().catch(() => undefined)
      }
    }
  }
}

export const MCP_MANAGER = createProfileServiceProxy('MCP_MANAGER', () => new MCPManager())

/**
 * Starts discovery/sign-in only from an explicit browser action, with a callback
 * and popup return URL constrained to the authenticated origin.
 */
export async function startMCPOAuth(manifest: MCPManifest, origin: string, returnURL: string, apiVersion: string): Promise<{ authorization_url?: string }> {
  const target = new URL(returnURL)
  if (target.origin !== origin || target.pathname !== `/api/${apiVersion}/connections/complete`) {
    throw new Error('Return to this Leon window to connect the account.')
  }
  for (const [state, pending] of authorizations) {
    if (pending.expires < Date.now()) {
      authorizations.delete(state)
      clearTimeout(pending.timer)
      await pending.auth.dispose()
      await pending.client.close().catch(() => undefined)
    }
  }
  if (authorizations.size >= MAXIMUM_AUTHORIZATIONS) {
    throw new Error('Too many pending sign-ins. Please try again later.')
  }
  const sdk = await import('@modelcontextprotocol/client')
  const state = randomBytes(32).toString('base64url')
  const id = `${manifest.toolkit_id}.${manifest.tool_id}`
  // Reauthorization must not leave a live client using an older in-memory grant.
  await MCP_MANAGER.close(id)
  let authorizationURL: string | undefined
  const auth = await createMCPAuth({ id, profile: getActiveProfileName(), source: manifest.source,
    state, redirectUri: getConnectionCallbackURL(origin, apiVersion, 'tools'),
    redirect: (url) => { authorizationURL = url.toString() } })
  const server = getMCPURL(manifest.source.url)
  const transport = new sdk.StreamableHTTPClientTransport(server, { authProvider: auth, fetch: createMCPFetch(server) })
  const client = new sdk.Client({ name: 'Leon AI', version: PACKAGE.version }, { listMaxPages: 4 })
  const { getInstalledMCP } = await import('../catalog/catalog')
  const installed = await getInstalledMCP(id)
  if (!installed || JSON.stringify(installed.source) !== JSON.stringify(manifest.source)) {
    await auth.dispose()
    throw new Error('This MCP installation is no longer available.')
  }
  const timer = setTimeout(() => {
    authorizations.delete(state)
    void auth.dispose()
    void client.close().catch(() => undefined)
  }, AUTHORIZATION_LIFETIME_MS)
  timer.unref()
  const pending: Authorization = { profile: getActiveProfileName(), manifest, transport, client, auth,
    returnURL: target.toString(), expires: Date.now() + AUTHORIZATION_LIFETIME_MS, consumed: false, timer }
  // Own the attempt before network discovery starts, not only after a browser
  // URL is returned. Removal can then cancel registration and late token writes.
  authorizations.set(state, pending)
  try {
    await client.connect(transport, { timeout: DISCOVERY_TIMEOUT_MS })
    const { tools } = await client.listTools(undefined, { timeout: DISCOVERY_TIMEOUT_MS })
    await saveMCPCache(manifest, functionsFor(tools), Boolean(auth.tokens()))
  } catch {
    if (!authorizationURL) {
      authorizations.delete(state)
      clearTimeout(timer)
      await auth.dispose()
      await client.close().catch(() => undefined)
      throw new Error('I could not start sign-in. This server may need a registered client ID or different authentication.')
    }
  }
  if (authorizations.get(state) !== pending) {
    await auth.dispose()
    await client.close().catch(() => undefined)
    throw new Error('This sign-in attempt was cancelled.')
  }
  if (authorizationURL) {
    return { authorization_url: authorizationURL }
  }
  authorizations.delete(state)
  clearTimeout(timer)
  await auth.dispose()
  await client.close()

  return {}
}

/**
 * Consumes one state before exchanging a code; retries cannot reuse a callback
 * or choose another profile. SDK verifies PKCE and the authorization issuer.
 */
export async function completeMCPOAuth(parameters: URLSearchParams): Promise<string | undefined> {
  const state = parameters.get('state') ?? ''
  const pending = authorizations.get(state)
  if (!pending || pending.consumed) {
    return undefined
  }
  pending.consumed = true
  clearTimeout(pending.timer)
  if (pending.expires < Date.now()) {
    authorizations.delete(state)
    await pending.auth.dispose()
    await pending.client.close().catch(() => undefined)

    return undefined
  }
  const target = new URL(pending.returnURL)
  target.searchParams.set('provider', `${pending.manifest.toolkit_id}.${pending.manifest.tool_id}`)
  target.searchParams.set('connection_result', 'failed')
  try {
    if (!parameters.get('error') && parameters.get('code')) {
      await runWithProfileContext({ profileName: pending.profile }, async () => {
        await pending.transport.finishAuth(parameters)
        if (authorizations.get(state) !== pending) {
          throw new Error('This sign-in attempt was cancelled.')
        }
        await MCP_MANAGER.discover(pending.manifest)
        const { TOOLKIT_REGISTRY } = await import('@/core')
        await TOOLKIT_REGISTRY.reload()
      })
      target.searchParams.set('connection_result', 'connected')
    }
  } catch {
    // The popup receives only a safe outcome, never an OAuth request or secret.
  } finally {
    authorizations.delete(state)
    await pending.auth.dispose()
    await pending.client.close().catch(() => undefined)
  }

  return target.toString()
}
