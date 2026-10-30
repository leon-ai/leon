import { LEON_SERVER_URL } from '../config'
import { APIError, ConnectionError } from './request-errors'

export { APIError } from './request-errors'

/**
 * Uses profile cookies without storing credentials in browser persistence.
 */
export async function requestAPI<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${LEON_SERVER_URL}/api/v1/${path}`, {
      ...options,
      credentials: 'include',
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
    })
  } catch (error) {
    if (options.signal?.aborted || error instanceof Error && error.name === 'AbortError') {
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
    if (!response.ok) {
      throw new Error('Leon could not complete this request. Please try again.')
    }
    throw new Error('Leon returned an invalid response. Please try again.')
  }
  if (!response.ok) {
    throw new APIError(response.status, typeof result?.message === 'string' && result.message.trim()
      ? result.message : 'Leon could not complete this request.')
  }

  return result
}
