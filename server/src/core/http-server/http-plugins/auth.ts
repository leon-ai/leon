import type { HTTPPluginReply, HTTPPluginRequest } from './types'

function readBearerToken(value: string | undefined): string {
  if (!value) {
    return ''
  }

  const match = value.match(/^Bearer\s+(.+)$/i)

  return match?.[1]?.trim() || ''
}

export function isHTTPPluginRequestAuthorized(
  request: HTTPPluginRequest,
  token: string
): boolean {
  const authorizationToken = readBearerToken(request.headers.authorization)
  const headerToken = String(
    request.headers['x-leon-http-plugin-token'] || ''
  ).trim()

  return authorizationToken === token || headerToken === token
}

export function rejectUnauthorizedHTTPPluginRequest(
  reply: HTTPPluginReply
): HTTPPluginReply {
  reply.statusCode = 401

  return reply.send({
    success: false,
    status: 401,
    code: 'http_plugin_unauthorized',
    message: 'HTTP plugin token is missing or invalid.'
  })
}
