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
import {
  enterProfileContext,
  getActiveProfileName
} from '@/core/profile-runtime/profile-context'
import { LEON_PROFILE_NAME } from '@/leon-roots'
import { IS_CLIENT_INTERFACE_AUTH_ENABLED } from '@/constants'
import { ensureActiveProfileRuntime } from '@/core/profile-runtime/initialize-profile-runtime'

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

/** Resolve the authenticated profile before any profile-owned HTTP API runs. */
export async function authenticateProfileHTTPRequest(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const credentialValue = readProfileCredentialFromHeaders({
    authorization: request.headers.authorization,
    cookie: request.headers.cookie,
    'x-leon-profile-token': String(
      request.headers['x-leon-profile-token'] || ''
    ),
    'x-leon-client-token': String(
      request.headers['x-leon-client-token'] || ''
    )
  })

  if (credentialValue) {
    const credential = authenticateProfileCredential(credentialValue)

    if (!credential) {
      rejectProfileAuthentication(reply)
      return
    }

    enterProfileContext({ profileName: credential.profileName })
    await ensureActiveProfileRuntime()
    return
  }

  if (IS_CLIENT_INTERFACE_AUTH_ENABLED) {
    rejectProfileAuthentication(reply)
    return
  }

  enterProfileContext({ profileName: LEON_PROFILE_NAME })
  await ensureActiveProfileRuntime()
}

export const profileAuthRoutes: FastifyPluginAsync<APIOptions> = async (
  fastify,
  options
) => {
  const authPath = `/api/${options.apiVersion}/profile-auth`

  fastify.get(authPath, async (request, reply) => {
    const credentialValue = readProfileCredentialFromHeaders({
      authorization: request.headers.authorization,
      cookie: request.headers.cookie,
      'x-leon-profile-token': String(
        request.headers['x-leon-profile-token'] || ''
      ),
      'x-leon-client-token': String(
        request.headers['x-leon-client-token'] || ''
      )
    })
    const credential = authenticateProfileCredential(credentialValue)

    if (!credential && IS_CLIENT_INTERFACE_AUTH_ENABLED) {
      rejectProfileAuthentication(reply)
      return
    }

    const profileName = credential?.profileName || LEON_PROFILE_NAME

    enterProfileContext({ profileName })
    reply.send({
      success: true,
      status: 200,
      authenticated: Boolean(credential) || !IS_CLIENT_INTERFACE_AUTH_ENABLED,
      profile_name: getActiveProfileName()
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
