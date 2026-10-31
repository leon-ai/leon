import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest
} from 'fastify'

import type { APIOptions } from '@/core/http-server/http-server'
import {
  authenticateProfileCredential,
  buildProfileAuthCookie,
  readProfileCredentialFromHeaders
} from '@/core/profile-auth'
import { enterProfileContext } from '@/core/profile-runtime/profile-context'
import { LEON_PROFILE_NAME } from '@/leon-roots'
import { IS_CLIENT_INTERFACE_AUTH_ENABLED } from '@/constants'
import { ensureActiveProfileRuntime } from '@/core/profile-runtime/initialize-profile-runtime'
import type { ProfileAuthentication } from './profile-auth-contract'

interface ProfileAuthBody {
  token?: string
}

function isSecureRequest(request: FastifyRequest): boolean {
  const forwardedProtocol = String(
    request.headers['x-forwarded-proto'] || ''
  )
    .split(',')[0]
    ?.trim()

  return request.protocol === 'https' || forwardedProtocol === 'https'
}

function rejectProfileAuthentication(reply: FastifyReply): void {
  reply.statusCode = 401
  reply.send({
    success: false,
    status: 401,
    code: 'profile_unauthorized',
    message: 'Leon profile token is missing or invalid.'
  })
}

/**
 * Validates request credentials without initializing the agent/profile runtime.
 * Explicitly rejected credentials never fall back to anonymous local access.
 */
export function readProfileAuthentication(request: Pick<FastifyRequest, 'headers'>): ProfileAuthentication {
  const value = readProfileCredentialFromHeaders({
    authorization: request.headers.authorization,
    cookie: request.headers.cookie,
    'x-leon-profile-token': String(request.headers['x-leon-profile-token'] || '')
  })
  const credential = authenticateProfileCredential(value)
  const authenticated = value ? Boolean(credential) : !IS_CLIENT_INTERFACE_AUTH_ENABLED

  return {
    authenticated,
    profile_name: authenticated ? credential?.profileName ?? LEON_PROFILE_NAME : null
  }
}

/**
 * Resolve the authenticated profile before any profile-owned HTTP API runs.
 */
export async function authenticateProfileHTTPRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  options: { initializeRuntime?: boolean } = {}
): Promise<void> {
  const auth = readProfileAuthentication(request)
  if (!auth.authenticated || !auth.profile_name) {
    rejectProfileAuthentication(reply)
    return
  }

  enterProfileContext({ profileName: auth.profile_name })
  if (options.initializeRuntime !== false) {
    await ensureActiveProfileRuntime()
  }
}

export const profileAuthRoutes: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  const authPath = `/api/${options.apiVersion}/profile-auth`

  fastify.get(authPath, async (request, reply) => {
    const auth = readProfileAuthentication(request)
    if (auth.authenticated && auth.profile_name) {
      enterProfileContext({ profileName: auth.profile_name })
    }

    reply.header('Cache-Control', 'private, no-store')
    reply.send({
      success: true,
      status: 200,
      ...auth
    })
  })

  fastify.post<{ Body: ProfileAuthBody }>(authPath, async (request, reply) => {
    const credential = authenticateProfileCredential(request.body?.token)

    if (!credential) {
      rejectProfileAuthentication(reply)
      return
    }

    enterProfileContext({ profileName: credential.profileName })
    reply.header(
      'set-cookie',
      buildProfileAuthCookie(credential.value, {
        secure: isSecureRequest(request)
      })
    )
    reply.send({
      success: true,
      status: 200,
      authenticated: true,
      profile_name: credential.profileName
    })
  })

  fastify.delete(authPath, async (request, reply) => {
    reply.header(
      'set-cookie',
      buildProfileAuthCookie('', {
        clear: true,
        secure: isSecureRequest(request)
      })
    )
    reply.send({
      success: true,
      status: 200,
      authenticated: false
    })
  })
}
