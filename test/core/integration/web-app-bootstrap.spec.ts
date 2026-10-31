import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import Fastify, { type FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'

import { webAppPlugin } from '@/core/http-server/web-app'
import { renderWebAppDocument } from '@/core/http-server/web-app-document'
import { PROFILE_AUTH_BOOTSTRAP_ID, type ProfileAuthentication } from '@/core/http-server/profile-auth-contract'
import { profileAuthRoutes } from '@/core/http-server/profile-auth-routes'
import { PROFILE_AUTH_COOKIE_NAME, PROFILE_TOKEN_ENV_NAME } from '@/core/profile-auth'
import { LEON_PROFILE_NAME } from '@/leon-roots'

const fixture = vi.hoisted(() => ({ root: '', authEnabled: true, initialize: vi.fn() }))
const DOCUMENT = '<!doctype html><html><head><title>Leon</title></head><body><div id="root"></div></body></html>'
let app: FastifyInstance

vi.mock('@/constants', () => ({
  get IS_CLIENT_INTERFACE_AUTH_ENABLED(): boolean {
    return fixture.authEnabled
  }
}))
vi.mock('@/core/profile-runtime/initialize-profile-runtime', () => ({
  ensureActiveProfileRuntime: fixture.initialize
}))
vi.mock('@/core/profile-runtime/profile-paths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/profile-runtime/profile-paths')>()

  return {
    ...actual,
    getProfilePaths: (name: string): ReturnType<typeof actual.getProfilePaths> => ({
      ...actual.getProfilePaths(name), dotEnv: path.join(fixture.root, name, '.env')
    })
  }
})

function readBootstrap(html: string): ProfileAuthentication {
  const start = html.indexOf(`id="${PROFILE_AUTH_BOOTSTRAP_ID}"`)
  expect(start).toBeGreaterThanOrEqual(0)
  const content = html.slice(html.indexOf('>', start) + 1, html.indexOf('</script>', start))

  return JSON.parse(content) as ProfileAuthentication
}

function cookie(profile: string): string {
  return `${PROFILE_AUTH_COOKIE_NAME}=${encodeURIComponent(`${profile}:${profile}-secret`)}`
}

beforeEach(async () => {
  fixture.root = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-html-bootstrap-'))
  fixture.authEnabled = true
  const assets = path.join(fixture.root, 'web')
  const legacy = path.join(fixture.root, 'legacy')
  await fs.mkdir(assets)
  await fs.mkdir(legacy)
  await fs.writeFile(path.join(legacy, 'index.html'), '<html><body>Legacy client</body></html>')
  await fs.writeFile(path.join(legacy, 'legacy.js'), 'export const legacy = true')
  await fs.writeFile(path.join(assets, 'index.html'), DOCUMENT)
  await fs.writeFile(path.join(assets, 'app.js'), 'export const ready = true')
  for (const name of ['alice', 'bob']) {
    const directory = path.join(fixture.root, name)
    await fs.mkdir(directory)
    await fs.writeFile(path.join(directory, '.env'), `${PROFILE_TOKEN_ENV_NAME}=${name}-secret\n`)
  }
  app = Fastify()
  app.register(fastifyStatic, { root: legacy, prefix: '/' })
  app.get('/', (_request, reply) => reply.sendFile('index.html'))
  app.get('/web-app', (_request, reply) => reply.redirect('/web-app/'))
  await app.register(webAppPlugin, { root: assets, prefix: '/web-app' })
  await app.register(profileAuthRoutes, { apiVersion: 'v1' })
  await app.ready()
})

it('listens and serves both clients and their assets without a frontend dev server', async () => {
  const origin = await app.listen({ host: '127.0.0.1', port: 0 })
  const [legacy, legacyAsset, redirect, document, asset] = await Promise.all([
    fetch(`${origin}/`),
    fetch(`${origin}/legacy.js`),
    fetch(`${origin}/web-app`, { redirect: 'manual' }),
    fetch(`${origin}/web-app/`),
    fetch(`${origin}/web-app/app.js`)
  ])
  expect(legacy.status).toBe(200)
  expect(await legacy.text()).toContain('Legacy client')
  expect(await legacyAsset.text()).toBe('export const legacy = true')
  expect(redirect.headers.get('location')).toBe('/web-app/')
  expect(document.status).toBe(200)
  expect(readBootstrap(await document.text())).toEqual({ authenticated: false, profile_name: null })
  expect(await asset.text()).toBe('export const ready = true')
})

afterEach(async () => {
  await app?.close()
  await fs.rm(fixture.root, { recursive: true, force: true })
})

it.each(['/web-app/', '/web-app/index.html', '/web-app/session/example'])(
  'bootstraps %s from its validated cookie without initializing models', async (url) => {
    const response = await app.inject({ url, headers: { cookie: cookie('alice') } })
    expect(response.statusCode).toBe(200)
    expect(readBootstrap(response.body)).toEqual({ authenticated: true, profile_name: 'alice' })
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(response.headers['vary']).toContain('Cookie')
    expect(response.headers['etag']).toBeUndefined()
    expect(response.body).not.toContain('alice-secret')
    expect(fixture.initialize).not.toHaveBeenCalled()
    const probe = await app.inject({ url: '/api/v1/profile-auth', headers: { cookie: cookie('alice') } })
    expect(probe.json()).toMatchObject(readBootstrap(response.body))
  }
)

it('does not reuse one profile document for another profile or conditional requests', async () => {
  await app.inject({ url: '/web-app/', headers: { cookie: cookie('alice') } })
  const response = await app.inject({
    url: '/web-app/', headers: { cookie: cookie('bob'), 'if-none-match': '"previous-document"' }
  })
  expect(response.statusCode).toBe(200)
  expect(readBootstrap(response.body)).toEqual({ authenticated: true, profile_name: 'bob' })
  expect(response.body).not.toContain('alice')
})

it('leaves missing or rejected credentials signed out', async () => {
  for (const value of ['', cookie('unknown'), `${PROFILE_AUTH_COOKIE_NAME}=alice%3Awrong`]) {
    const response = await app.inject({ url: '/web-app/', headers: { cookie: value } })
    expect(readBootstrap(response.body)).toEqual({ authenticated: false, profile_name: null })
  }
})

it('supports configured local access but does not ignore an explicitly invalid credential', async () => {
  fixture.authEnabled = false
  const local = await app.inject('/web-app/')
  expect(readBootstrap(local.body)).toEqual({ authenticated: true, profile_name: LEON_PROFILE_NAME })
  const invalid = await app.inject({ url: '/web-app/', headers: { cookie: cookie('unknown') } })
  expect(readBootstrap(invalid.body)).toEqual({ authenticated: false, profile_name: null })
})

it('escapes HTML delimiters while preserving the JSON identity exactly', () => {
  const auth = { authenticated: true, profile_name: '</script><script>alert("name")</script>' }
  const document = renderWebAppDocument(DOCUMENT, auth)
  expect(document).not.toContain(auth.profile_name)
  expect(readBootstrap(document)).toEqual(auth)
})

it('keeps assets independent of identity and does not turn missing assets into HTML', async () => {
  const asset = await app.inject('/web-app/app.js')
  expect(asset.statusCode).toBe(200)
  expect(asset.body).toBe('export const ready = true')
  expect(asset.body).not.toContain(PROFILE_AUTH_BOOTSTRAP_ID)
  expect((await app.inject('/web-app/missing.js')).statusCode).toBe(404)
})
