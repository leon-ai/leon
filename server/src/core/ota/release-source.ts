import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

import axios from 'axios'

import { FileHelper } from '@/helpers/file-helper'

const CACHE_INTERVAL_MS = 5 * 60_000
const FAILURE_BACKOFF_MS = 60_000
const REQUEST_TIMEOUT_MS = 15_000
const MAXIMUM_RESPONSE_BYTES = 1_048_576

interface ReleaseCache<T> {
  data?: T
  etag?: string | undefined
  checkedAt: number
  retryAt: number
}

/**
 * Shares bounded release metadata across restarts. Conditional requests reduce
 * transferred bytes; GitHub's unauthenticated IP limit still applies to them.
 * Rate-limited checks wait for the server's reset instead of retrying in a loop.
 */
export function createReleaseSource(directory: string): <T>(url: string) => Promise<T> {
  const memory = new Map<string, ReleaseCache<unknown>>()

  return async <T>(url: string): Promise<T> => {
    const filename = path.join(directory, `releases-${createHash('sha256').update(url).digest('hex')}.json`)
    let cached = memory.get(url) as ReleaseCache<T> | undefined
    if (!cached) {
      cached = await fs.readFile(filename, 'utf8').then((value) => JSON.parse(value) as ReleaseCache<T>).catch(() => ({ checkedAt: 0, retryAt: 0 }))
      memory.set(url, cached)
    }
    if (cached.retryAt > Date.now()) {
      throw new Error(`I can check for updates again after ${new Date(cached.retryAt).toLocaleTimeString()}.`)
    }
    if (cached.data !== undefined && Date.now() - cached.checkedAt < CACHE_INTERVAL_MS) {
      return cached.data
    }
    const response = await axios.get<T>(url, {
      timeout: REQUEST_TIMEOUT_MS,
      maxContentLength: MAXIMUM_RESPONSE_BYTES,
      headers: { Accept: 'application/vnd.github+json', ...(cached.etag ? { 'If-None-Match': cached.etag } : {}) },
      validateStatus: () => true
    })
    if (response.status === 304 && cached.data !== undefined) {
      cached.checkedAt = Date.now()
    } else if (response.status === 200) {
      cached.data = response.data
      cached.etag = response.headers['etag'] as string | undefined
      cached.checkedAt = Date.now()
      cached.retryAt = 0
    } else {
      if ([403, 429].includes(response.status)) {
        const retryAfter = response.headers['retry-after'] as string | undefined
        const retryTime = retryAfter && Number.isFinite(Number(retryAfter))
          ? Date.now() + Number(retryAfter) * 1_000 : Date.parse(retryAfter ?? '')
        const resetTime = Number(response.headers['x-ratelimit-reset']) * 1_000
        cached.retryAt = Math.max(Date.now() + FAILURE_BACKOFF_MS, retryTime || 0, resetTime || 0)
        await FileHelper.writeAtomicJSON(filename, cached)
      }
      throw Object.assign(new Error(`I could not check published releases (${response.status}).`), { status: response.status })
    }
    await FileHelper.writeAtomicJSON(filename, cached)
    return cached.data as T
  }
}
