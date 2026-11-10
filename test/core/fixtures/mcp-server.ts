import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { once } from 'node:events'

/**
 * Runs a controlled HTTP MCP/OAuth peer without external accounts or models.
 * Responses travel over real sockets, including progress and cancellation.
 */
export async function startMCPFixture(requireAuthorization = false): Promise<{
  origin: string
  url: string
  calls: Array<{ method: string, params?: Record<string, unknown> }>
  held: Map<string, () => void>
  readonly requests: number
  readonly tokenExchanges: number
  oauth: { hold: boolean }
  close: () => Promise<void>
}> {
  const calls: Array<{ method: string, params?: Record<string, unknown> }> = []
  const held = new Map<string, () => void>()
  let origin = ''
  let challenge = ''
  let tokenExchanges = 0
  let requests = 0
  const oauth = { hold: false }
  const server = createServer(async (request, response) => {
    requests += 1
    const url = new URL(request.url!, origin)
    const json = (value: unknown, status = 200): void => {
      response.writeHead(status, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(value))
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk))
    }
    const body = Buffer.concat(chunks).toString()
    if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
      json({ resource: `${origin}/mcp`, authorization_servers: [origin] })
      return
    }
    if (url.pathname.startsWith('/.well-known/oauth-authorization-server')) {
      json({ issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`, response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'],
        authorization_response_iss_parameter_supported: true })
      return
    }
    if (url.pathname === '/register') {
      json({ ...JSON.parse(body), client_id: 'fixture-client' }, 201)
      return
    }
    if (url.pathname === '/authorize') {
      challenge = url.searchParams.get('code_challenge')!
      const callback = new URL(url.searchParams.get('redirect_uri')!)
      callback.searchParams.set('code', 'fixture-code')
      callback.searchParams.set('state', url.searchParams.get('state')!)
      callback.searchParams.set('iss', origin)
      response.writeHead(302, { Location: callback.toString() }).end()
      return
    }
    if (url.pathname === '/token') {
      tokenExchanges += 1
      const values = new URLSearchParams(body)
      const valid = values.get('code') === 'fixture-code' && challenge &&
        createHash('sha256').update(values.get('code_verifier') ?? '').digest('base64url') === challenge
      const finish = (): void => json(valid ? {
        access_token: 'fixture-access-secret', token_type: 'Bearer', expires_in: 3_600,
        refresh_token: 'fixture-refresh-secret'
      } : { error: 'invalid_grant' }, valid ? 200 : 400)
      if (oauth.hold) {
        held.set('oauth-token', finish)
        response.once('close', () => held.delete('oauth-token'))
      } else {
        finish()
      }
      return
    }
    if (url.pathname !== '/mcp') {
      json({ error: 'not_found' }, 404)
      return
    }
    if (requireAuthorization && request.headers.authorization !== 'Bearer fixture-access-secret') {
      response.setHeader('WWW-Authenticate', `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`)
      json({ error: 'unauthorized' }, 401)
      return
    }
    if (request.method !== 'POST') {
      response.writeHead(405).end()
      return
    }
    const message = JSON.parse(body) as { id?: string | number, method: string, params?: Record<string, unknown> }
    calls.push(message)
    if (message.id === undefined) {
      response.writeHead(202).end()
      return
    }
    const result = (value: unknown): void => json({ jsonrpc: '2.0', id: message.id, result: value })
    if (message.method === 'initialize') {
      result({ protocolVersion: '2025-11-25', capabilities: { tools: { listChanged: true } },
        serverInfo: { name: 'Controlled MCP peer', version: '1.0.0' } })
    } else if (message.method === 'tools/list') {
      result({ tools: [{ name: 'workspace.echo', description: 'Echo controlled workspace data.',
        inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } }] })
    } else if (message.method === 'tools/call') {
      const args = message.params!['arguments'] as Record<string, unknown>
      const content = { content: [{ type: 'text', text: String(args['value']) }],
        structuredContent: { value: args['value'] }, ...(args['value'] === 'failure' ? { isError: true } : {}) }
      if (String(args['value']).startsWith('hold-')) {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        const send = (value: unknown): void => { response.write(`data: ${JSON.stringify(value)}\n\n`) }
        const meta = message.params!['_meta'] as Record<string, unknown> | undefined
        if (meta?.['progressToken'] !== undefined) {
          send({ jsonrpc: '2.0', method: 'notifications/progress', params: {
            progressToken: meta['progressToken'], progress: 1, total: 2, message: 'Reading workspace' } })
        }
        held.set(String(args['value']), () => {
          send({ jsonrpc: '2.0', id: message.id, result: content })
          response.end()
        })
        response.once('close', () => held.delete(String(args['value'])))
      } else {
        result(content)
      }
    } else {
      json({ jsonrpc: '2.0', id: message.id, error: { code: -32_601, message: 'Unknown method' } })
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`

  return {
    origin, url: `${origin}/mcp`, calls, held, oauth,
    get requests(): number { return requests },
    get tokenExchanges(): number { return tokenExchanges },
    async close(): Promise<void> {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  }
}
