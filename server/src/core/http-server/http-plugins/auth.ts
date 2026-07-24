import type { HTTPPluginReply, HTTPPluginRequest } from './types'
import {
  authenticateProfileCredential,
  readProfileCredentialFromHeaders
} from '@/core/profile-auth'
import { enterProfileContext } from '@/core/profile-runtime/profile-context'

/** Checks the supported authentication headers for a dynamically loaded HTTP plugin. */
export function isHTTPPluginRequestAuthorized(
  request: HTTPPluginRequest
): boolean {
  const credential = readProfileCredentialFromHeaders({
    authorization: request.headers.authorization,
    cookie: request.headers.cookie,
    'x-leon-profile-token': String(
      request.headers['x-leon-profile-token'] || ''
    )
  })

  const authenticatedCredential = authenticateProfileCredential(credential)

  if (!authenticatedCredential) {
    return false
  }

  enterProfileContext({ profileName: authenticatedCredential.profileName })

  return true
}

/** Sends the standard unauthorized response from a dynamically loaded HTTP plugin. */
export function rejectUnauthorizedHTTPPluginRequest(
  reply: HTTPPluginReply
): HTTPPluginReply {
  reply.statusCode = 401

  return reply.send({
    success: false,
    status: 401,
    code: 'profile_unauthorized',
    message: 'Leon profile token is missing or invalid.'
  })
}
