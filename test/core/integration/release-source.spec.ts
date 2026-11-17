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
let limited: boolean

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-release-cache-'))
  now = Date.now()
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  requests = []
  limited = false
  server = http.createServer((request, response) => {
    requests.push(String(request.headers['if-none-match'] ?? ''))
    if (limited) {
      response.writeHead(429, { 'retry-after': '60', 'x-ratelimit-reset': String(Math.ceil((now + 1_800_000) / 1_000)) }).end()
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

it('persists the longer rate-limit deadline and avoids requests until GitHub permits retry', async () => {
  limited = true
  await expect(createReleaseSource(directory)(origin)).rejects.toThrow('429')
  now += 120_000
  await expect(createReleaseSource(directory)(origin)).rejects.toThrow('again after')
  expect(requests).toHaveLength(1)
  now += 1_800_000
  limited = false
  expect(await createReleaseSource(directory)(origin)).toEqual([{ version: '2.0.0-alpha.0' }])
  expect(requests).toHaveLength(2)
})
