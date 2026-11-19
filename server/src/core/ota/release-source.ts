import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

import axios, { type AxiosResponse } from 'axios'

import { FileHelper } from '@/helpers/file-helper'

const CACHE_INTERVAL_MS = 5 * 60_000
const FAILURE_BACKOFF_MS = 60_000
const MAXIMUM_FAILURE_BACKOFF_MS = 15 * 60_000
const REQUEST_TIMEOUT_MS = 15_000
const MAXIMUM_RESPONSE_BYTES = 1_048_576
const SECONDARY_RATE_LIMIT_PATTERN = /\bsecondary rate limit\b/i

interface ReleaseCache<T> {
  data?: T
  etag?: string | undefined
  checkedAt: number
  retryAt: number
  fallbackBackoffMs?: number
}

function rateLimitError(retryAt: number): Error {
  const seconds = Math.max(0, Math.ceil((retryAt - Date.now()) / 1_000))

  return Object.assign(new Error(`I can check for updates again after ${new Date(retryAt).toLocaleTimeString()}.`), {
    statusCode: 429, headers: { 'retry-after': String(seconds) }
  })
}

function rateLimitDeadline(response: AxiosResponse<unknown>, now: number): number | undefined {
  const { status, headers, data } = response
  if (status !== 403 && status !== 429) {
    return undefined
  }

  const quotaExhausted = headers['x-ratelimit-remaining'] === '0'
  const retryAfter = headers['retry-after']
  let retryAt = 0
  if (typeof retryAfter === 'string' && retryAfter.trim()) {
    const seconds = Number(retryAfter)
    const timestamp = Number.isSafeInteger(seconds) && seconds >= 0 ? now + seconds * 1_000 : Date.parse(retryAfter)
    retryAt = new Date(timestamp).getTime() || 0
  }

  const message = (data as { message?: unknown } | null)?.message
  const secondaryLimit = typeof message === 'string' && SECONDARY_RATE_LIMIT_PATTERN.test(message)
  if (status === 403 && !quotaExhausted && !secondaryLimit && retryAt < now) {
    return undefined
  }

  // GitHub reports the primary window's reset even when it has quota left.
  const resetAt = quotaExhausted ? new Date(Number(headers['x-ratelimit-reset']) * 1_000).getTime() : 0
  return Math.max(retryAt, resetAt || 0)
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
      throw rateLimitError(cached.retryAt)
    }
    if (cached.data !== undefined && Date.now() - cached.checkedAt < CACHE_INTERVAL_MS) {
      return cached.data
    }
    const response = await axios.get<T>(url, {
      timeout: REQUEST_TIMEOUT_MS,
      maxContentLength: MAXIMUM_RESPONSE_BYTES,
      headers: { Accept: 'application/vnd.github+json', ...(cached.etag ? { 'If-None-Match': cached.etag } : {}) },
      validateStatus: () => true
    }).catch((cause: unknown) => {
      throw Object.assign(new Error('I could not check published releases.', { cause }), { statusCode: 503 })
    })
    if (response.status === 304 && cached.data !== undefined) {
      cached.checkedAt = Date.now()
    } else if (response.status === 200) {
      cached.data = response.data
      cached.etag = response.headers['etag'] as string | undefined
      cached.checkedAt = Date.now()
    } else {
      const now = Date.now()
      const deadline = rateLimitDeadline(response, now)
      if (deadline === undefined) {
        throw Object.assign(new Error(`I could not check published releases (${response.status}).`), {
          statusCode: 503, upstreamStatus: response.status
        })
      }

      if (deadline > now) {
        cached.retryAt = deadline
        delete cached.fallbackBackoffMs
      } else {
        // Increase the wait only when successive responses give no deadline.
        cached.fallbackBackoffMs = cached.fallbackBackoffMs
          ? Math.min(cached.fallbackBackoffMs * 2, MAXIMUM_FAILURE_BACKOFF_MS)
          : FAILURE_BACKOFF_MS
        cached.retryAt = now + cached.fallbackBackoffMs
      }
      await FileHelper.writeAtomicJSON(filename, cached)
      throw rateLimitError(cached.retryAt)
    }

    cached.retryAt = 0
    delete cached.fallbackBackoffMs
    await FileHelper.writeAtomicJSON(filename, cached)
    return cached.data as T
  }
}
