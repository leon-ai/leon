import { LEON_SERVER_URL } from '../config'
import { APIError, ConnectionError } from './request-errors'

export { APIError } from './request-errors'

const UPLOAD_IDLE_TIMEOUT_MS = 60_000
const UPLOAD_RESPONSE_TIMEOUT_MS = 120_000

interface APIRequestOptions extends RequestInit {
  onUploadProgress?: (loaded: number, total?: number) => void
}

/**
 * Uses native upload events for measured file transfer progress, then rejoins
 * the shared response/error handling. Request state remains owned by Query.
 */
function uploadRequest(url: string, options: APIRequestOptions, headers: Headers): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    let timeout: ReturnType<typeof setTimeout> | undefined
    let lastLoaded = 0
    const abort = (): void => request.abort()
    const cleanup = (): void => {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', abort)
      request.upload.onprogress = null
      request.upload.onload = null
      request.onload = null
      request.onerror = null
      request.onabort = null
    }
    const fail = (error: Error): void => {
      cleanup()
      reject(error)
    }
    const waitForProgress = (duration: number, message: string): void => {
      clearTimeout(timeout)
      timeout = setTimeout(() => {
        // Detach abort handling first so a timeout remains a retryable failure,
        // rather than being mistaken for the owner's silent cancellation.
        fail(new DOMException(message, 'TimeoutError'))
        request.abort()
      }, duration)
    }

    if (options.signal?.aborted) {
      reject(options.signal.reason ?? new DOMException('The upload was cancelled.', 'AbortError'))
      return
    }
    if (!(options.body instanceof Blob)) {
      reject(new TypeError('Upload progress requires a file body.'))
      return
    }
    const size = options.body.size

    request.upload.onprogress = (event): void => {
      if (event.loaded > lastLoaded) {
        lastLoaded = event.loaded
        waitForProgress(UPLOAD_IDLE_TIMEOUT_MS, 'This upload stopped making progress. Please retry it.')
      }
      options.onUploadProgress?.(event.loaded, event.lengthComputable ? event.total : size)
    }
    request.upload.onload = (): void => {
      options.onUploadProgress?.(size, size)
      waitForProgress(UPLOAD_RESPONSE_TIMEOUT_MS, 'I did not receive confirmation for this upload. Please retry it.')
    }
    request.onload = (): void => {
      try {
        const response = new Response(request.responseText || null, { status: request.status, statusText: request.statusText })
        cleanup()
        resolve(response)
      } catch (error) {
        fail(error instanceof Error ? error : new Error('I could not read the upload response.'))
      }
    }
    request.onerror = (): void => fail(new ConnectionError())
    request.onabort = (): void => fail(new DOMException('The upload was cancelled.', 'AbortError'))
    request.open(options.method ?? 'POST', url)
    request.withCredentials = true
    for (const [name, value] of headers) {
      request.setRequestHeader(name, value)
    }
    options.signal?.addEventListener('abort', abort, { once: true })
    try {
      options.signal?.throwIfAborted()
      waitForProgress(UPLOAD_IDLE_TIMEOUT_MS, 'This upload stopped making progress. Please retry it.')
      request.send(options.body)
    } catch (error) {
      fail(error instanceof Error ? error : new ConnectionError())
    }
  })
}

/**
 * Uses profile cookies without storing credentials in browser persistence.
 */
export async function requestAPI<T>(path: string, options: APIRequestOptions = {}): Promise<T> {
  let response: Response
  const { onUploadProgress, ...requestOptions } = options
  const url = `${LEON_SERVER_URL}/api/v1/${path}`
  const headers = new Headers(options.headers)
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  try {
    response = onUploadProgress ? await uploadRequest(url, options, headers) : await fetch(url, {
      ...requestOptions,
      credentials: 'include',
      headers
    })
  } catch (error) {
    if (options.signal?.aborted || error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw error
    }
    throw new ConnectionError()
  }

  let result: T & { message?: string }
  try {
    result = await response.json() as typeof result
  } catch (error) {
    if (options.signal?.aborted || error instanceof Error && error.name === 'AbortError') {
      throw error
    }
    // A response body can fail after headers arrive when the connection drops.
    if (!navigator.onLine || error instanceof TypeError) {
      throw new ConnectionError()
    }
    if (!response.ok) {
      throw new Error('I could not complete this request. Please try again.')
    }
    throw new Error('I returned an invalid response. Please try again.')
  }
  if (!response.ok) {
    throw new APIError(response.status, typeof result?.message === 'string' && result.message.trim()
      ? result.message : 'I could not complete this request.')
  }

  return result
}
