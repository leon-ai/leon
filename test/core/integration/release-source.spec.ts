import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createReleaseSource } from '@/core/ota/release-source'

let directory: string
let server: http.Server
let origin: string
let now: number
let requests: string[]
let failure: { status: number, headers?: http.OutgoingHttpHeaders, message: string } | undefined

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-release-cache-'))
  now = Math.floor(Date.now() / 1_000) * 1_000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  requests = []
  failure = undefined
  server = http.createServer((request, response) => {
    requests.push(String(request.headers['if-none-match'] ?? ''))
    if (failure) {
      response.writeHead(failure.status, { 'content-type': 'application/json', ...failure.headers })
        .end(JSON.stringify({ message: failure.message }))
    } else if (request.headers['if-none-match'] === 'release-identity') {
      response.writeHead(304).end()
    } else {
      response.writeHead(200, { etag: 'release-identity', 'content-type': 'application/json' }).end(JSON.stringify([{ version: '2.0.0-alpha.0' }]))
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

afterEach(async () => {
  vi.restoreAllMocks()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await fs.rm(directory, { recursive: true, force: true })
})

it('reuses recent metadata across restarts and revalidates unchanged releases with their ETag', async () => {
  const source = createReleaseSource(directory)
  const first = await source(origin)
  expect(await createReleaseSource(directory)(origin)).toEqual(first)
  expect(requests).toHaveLength(1)
  now += 6 * 60_000
  expect(await source(origin)).toEqual(first)
  expect(requests).toEqual(['', 'release-identity'])
})

it('persists the exhausted primary quota deadline when a secondary limit also applies', async () => {
  const reset = Math.ceil((now + 1_800_000) / 1_000)
  const retryAt = reset * 1_000
  failure = {
    status: 429, message: 'You have exceeded a secondary rate limit.',
    headers: { 'retry-after': '60', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) }
  }
  await expect(createReleaseSource(directory)(origin)).rejects.toMatchObject({ statusCode: 429, headers: { 'retry-after': '1800' } })
  now += 120_000
  await expect(createReleaseSource(directory)(origin)).rejects.toMatchObject({ statusCode: 429, headers: { 'retry-after': '1680' } })
  expect(requests).toHaveLength(1)
  now = retryAt
  failure = undefined
  expect(await createReleaseSource(directory)(origin)).toEqual([{ version: '2.0.0-alpha.0' }])
  expect(requests).toHaveLength(2)
})

it('honors Retry-After while the primary quota still has requests available', async () => {
  const retryAt = now + 20_000
  failure = {
    status: 429, message: 'Too many requests.',
    headers: { 'retry-after': '20', 'x-ratelimit-remaining': '10', 'x-ratelimit-reset': String(Math.ceil((now + 1_800_000) / 1_000)) }
  }
  const source = createReleaseSource(directory)
  await expect(source(origin)).rejects.toMatchObject({ statusCode: 429, headers: { 'retry-after': '20' } })
  now = retryAt - 1
  await expect(source(origin)).rejects.toMatchObject({ statusCode: 429, headers: { 'retry-after': '1' } })
  expect(requests).toHaveLength(1)
  now = retryAt
  failure = undefined
  await expect(source(origin)).resolves.toEqual([{ version: '2.0.0-alpha.0' }])
})

it('increases the fallback wait for repeated secondary limits without a usable deadline', async () => {
  failure = {
    status: 403, message: 'You have exceeded a secondary rate limit.',
    headers: { 'x-ratelimit-remaining': '10', 'x-ratelimit-reset': String(Math.ceil((now + 1_800_000) / 1_000)) }
  }
  await expect(createReleaseSource(directory)(origin)).rejects.toMatchObject({ statusCode: 429, headers: { 'retry-after': '60' } })
  now += 60_000
  await expect(createReleaseSource(directory)(origin)).rejects.toMatchObject({ statusCode: 429, headers: { 'retry-after': '120' } })
  expect(requests).toHaveLength(2)
})

it('allows a new check after an upstream forbidden response unrelated to rate limits', async () => {
  failure = {
    status: 403, message: 'Forbidden.',
    headers: { 'x-ratelimit-remaining': '10', 'x-ratelimit-reset': String(Math.ceil((now + 1_800_000) / 1_000)) }
  }
  const source = createReleaseSource(directory)
  await expect(source(origin)).rejects.toMatchObject({ statusCode: 503, upstreamStatus: 403 })
  failure = undefined
  await expect(source(origin)).resolves.toEqual([{ version: '2.0.0-alpha.0' }])
  expect(requests).toHaveLength(2)
})
