import { net, type Session, type IncomingMessage } from 'electron'
import { Transform, Writable, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

interface BackendRequest {
  session: Session
  url: string | URL
  method?: string
  headers?: Record<string, string | string[]>
  body?: Readable
  maximumBytes?: number
  signal?: AbortSignal
  onProgress?: (bytes: number) => void
  cookie?: string
}

export type BackendResponse = IncomingMessage & Readable
interface BackendOperation {
  response: Promise<BackendResponse>
  finished: Promise<unknown>
  abort: () => void
}

const CONNECT_TIMEOUT_MS = 10_000
const IDLE_TIMEOUT_MS = 60_000

/**
 * Streams request bodies through Chromium with backpressure. Its default
 * non-chunked mode buffers the entire body and must not be used for attachments.
 */
export function requestBackend({ session, url, method = 'GET', headers = {}, body,
  maximumBytes = 0, signal, onProgress, cookie }: BackendRequest): BackendOperation {
  const request = net.request({ session, url: String(url), method, redirect: 'error',
    useSessionCookies: cookie === undefined })
  if (body) {
    request.chunkedEncoding = true
  }
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== 'content-length') {
      request.setHeader(name, Array.isArray(value) ? value.join(', ') : value)
    }
  }
  if (cookie !== undefined && cookie) {
    request.setHeader('cookie', cookie)
  }
  let failure: Error | undefined
  let timer: NodeJS.Timeout | undefined
  const cancellation = new AbortController()
  signal = signal ? AbortSignal.any([signal, cancellation.signal]) : cancellation.signal
  const abort = (): void => request.abort()
  request.once('abort', () => {
    clearTimeout(timer)
    cancellation.abort()
  })
  const touch = (duration = IDLE_TIMEOUT_MS): void => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      failure = Object.assign(new Error('The Leon server stopped responding.'), { status: 504 })
      request.abort()
    }, duration)
    timer.unref()
  }
  const response = new Promise<BackendResponse>((resolve, reject) => {
    request.once('error', (error) => reject(failure ?? error))
    request.once('abort', () => reject(failure ?? new DOMException('The request was cancelled.', 'AbortError')))
    request.once('response', (message) => {
      // Electron's declaration omits the Readable methods exposed by this event.
      const incoming = message as BackendResponse
      incoming.pause()
      touch()
      incoming.on('data', () => touch())
      incoming.once('end', () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
      })
      incoming.once('error', () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
      })
      resolve(incoming)
    })
  })
  signal?.addEventListener('abort', abort, { once: true })
  touch(CONNECT_TIMEOUT_MS)
  if (signal?.aborted) {
    request.abort()
  }
  let bytes = 0
  const finished = body ? pipeline(body, new Transform({
    transform(chunk, _encoding, callback): void {
      bytes += chunk.length
      if (bytes > maximumBytes) {
        failure = Object.assign(new Error('This file exceeds its attachment size limit.'), { status: 413 })
        callback(failure)
        return
      }
      touch()
      onProgress?.(bytes)
      callback(null, chunk)
    }
  }), new Writable({
    write(chunk, _encoding, callback): void {
      request.write(chunk, undefined, callback)
    },
    final(callback): void {
      request.end(undefined, undefined, callback)
    },
    destroy(error, callback): void {
      if (error) {
        request.abort()
      }
      callback(error)
    }
  }), { ...(signal ? { signal } : {}) }) : Promise.resolve(request.end())
  void finished.catch((error) => {
    failure ??= error
    request.abort()
  })
  void response.catch(() => {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  })

  return { response, finished, abort }
}

/**
 * Bounds small control responses independently from streamed file contents.
 */
export async function readBackendJSON(response: BackendResponse, maximumBytes = 65_536): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of response) {
    bytes += chunk.length
    if (bytes > maximumBytes) {
      response.destroy()
      throw new Error('The Leon server returned an oversized response.')
    }
    chunks.push(chunk)
  }

  return JSON.parse(Buffer.concat(chunks).toString())
}
