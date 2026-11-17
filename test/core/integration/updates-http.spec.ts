import fs from 'node:fs/promises'
import path from 'node:path'

import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { updatesPlugin } from '@/core/http-server/api/updates'
import { authenticateProfileHTTPRequest } from '@/core/http-server/profile-auth-routes'
import { PROFILE_AUTH_COOKIE_NAME, PROFILE_TOKEN_ENV_NAME } from '@/core/profile-auth'
import { setShutdownHandler } from '@/core/server-lifecycle'
import { LEON_UPDATE_EXIT_CODE } from '../../../bridges/runtime/contracts/updates'
import { createGitUpdateFixture, type GitUpdateFixture } from '../../fixtures/git-update'
import { UPDATE_FIXTURE } from '../../fixtures/updates'

const fixture = vi.hoisted(() => ({ root: '', initialize: vi.fn() }))

vi.mock('@/constants', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/constants')>(), IS_CLIENT_INTERFACE_AUTH_ENABLED: true
}))
vi.mock('@/core/profile-runtime/initialize-profile-runtime', () => ({ ensureActiveProfileRuntime: fixture.initialize }))
vi.mock('@/core/profile-runtime/profile-paths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/profile-runtime/profile-paths')>()

  return { ...actual, getProfilePaths: (name: string): ReturnType<typeof actual.getProfilePaths> => ({
    ...actual.getProfilePaths(name), dotEnv: path.join(fixture.root, name, '.env')
  }) }
})

let install: GitUpdateFixture
let app: FastifyInstance
let exits: number[]
const cookie = `${PROFILE_AUTH_COOKIE_NAME}=${encodeURIComponent('alice:fixture-secret')}`

beforeEach(async () => {
  install = await createGitUpdateFixture()
  fixture.root = path.join(install.home, 'profiles')
  await fs.mkdir(path.join(fixture.root, 'alice'), { recursive: true })
  await fs.writeFile(path.join(fixture.root, 'alice', '.env'), `${PROFILE_TOKEN_ENV_NAME}=fixture-secret\n`)
  exits = []
  setShutdownHandler((code) => exits.push(code ?? 0))
  app = Fastify()
  app.addHook('onRequest', (request, reply) => authenticateProfileHTTPRequest(request, reply, { initializeRuntime: false }))
  await app.register(updatesPlugin, { apiVersion: 'v1', service: install.service })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  setShutdownHandler(() => undefined)
  await fs.rm(install.home, { recursive: true, force: true })
})

it('requires an existing profile cookie before checking or scheduling any update', async () => {
  for (const [method, url] of [['GET', '/api/v1/updates'], ['POST', '/api/v1/updates/check'], ['POST', '/api/v1/updates/apply']] as const) {
    expect((await app.inject({ method, url })).statusCode).toBe(401)
    expect((await app.inject({ method, url, headers: { cookie: `${PROFILE_AUTH_COOKIE_NAME}=alice%3Aincorrect` } })).statusCode).toBe(401)
  }
  expect(exits).toEqual([])
  const response = await app.inject({ method: 'POST', url: '/api/v1/updates/check', headers: { cookie } })
  expect(response.statusCode).toBe(200)
  expect(response.json().check.release.version).toBe(UPDATE_FIXTURE.check!.release!.version)
  expect(fixture.initialize).not.toHaveBeenCalled()
})

it('schedules only reviewed releases and keeps installation paths host-owned', async () => {
  await app.inject({ method: 'POST', url: '/api/v1/updates/check', headers: { cookie } })
  for (const body of [{}, { tag: 'unreviewed' }]) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/updates/apply', headers: { cookie }, payload: body })
    expect(response.statusCode).toBeGreaterThanOrEqual(400)
  }
  expect(exits).toEqual([])
  const response = await app.inject({ method: 'POST', url: '/api/v1/updates/apply', headers: { cookie },
    payload: { tag: UPDATE_FIXTURE.check!.release!.tag, root: '/another-install', revision: 'unreviewed' } })
  expect(response.statusCode).toBe(202)
  expect(response.json().state).not.toHaveProperty('root')
  await expect.poll(() => exits).toEqual([LEON_UPDATE_EXIT_CODE])
  expect(JSON.parse(await fs.readFile(install.statePath, 'utf8'))).toMatchObject({ profile: 'alice', root: install.checkout, expectedHead: install.before })
})
