import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const profileAuthMocks = vi.hoisted(() => ({
  authenticateProfileCredential: vi.fn(),
  enterProfileContext: vi.fn(),
  getActiveProfileName: vi.fn(() => 'just-me')
}))

vi.mock('@/constants', () => ({
  IS_CLIENT_INTERFACE_AUTH_ENABLED: true
}))
vi.mock('@/leon-roots', () => ({ LEON_PROFILE_NAME: 'just-me' }))
vi.mock('@/core/profile-auth', () => ({
  authenticateProfileCredential:
    profileAuthMocks.authenticateProfileCredential,
  buildProfileAuthCookie: vi.fn(),
  readProfileCredentialFromHeaders: vi.fn(() => '')
}))
vi.mock('@/core/profile-runtime/profile-context', () => ({
  enterProfileContext: profileAuthMocks.enterProfileContext,
  getActiveProfileName: profileAuthMocks.getActiveProfileName
}))
vi.mock('@/core/profile-runtime/initialize-profile-runtime', () => ({
  ensureActiveProfileRuntime: vi.fn()
}))

import { profileAuthRoutes } from '@/core/http-server/profile-auth-routes'

describe('profile auth routes', () => {
  beforeEach(() => {
    profileAuthMocks.authenticateProfileCredential.mockReturnValue(null)
    profileAuthMocks.enterProfileContext.mockClear()
  })

  it('reports an unauthenticated browser without returning an HTTP error', async () => {
    const fastify = Fastify()

    await fastify.register(profileAuthRoutes, { apiVersion: 'v1' })

    const response = await fastify.inject({
      method: 'GET',
      url: '/api/v1/profile-auth'
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      success: true,
      status: 200,
      authenticated: false,
      profile_name: null
    })
    expect(profileAuthMocks.enterProfileContext).not.toHaveBeenCalled()

    await fastify.close()
  })

  it('keeps invalid token submissions unauthorized', async () => {
    const fastify = Fastify()

    await fastify.register(profileAuthRoutes, { apiVersion: 'v1' })

    const response = await fastify.inject({
      method: 'POST',
      url: '/api/v1/profile-auth',
      payload: { token: 'just-me:invalid' }
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({
      success: false,
      code: 'profile_unauthorized'
    })

    await fastify.close()
  })
})
