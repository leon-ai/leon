import dns from 'node:dns'
import { isIP } from 'node:net'

import type { AxiosInstance } from 'axios'
import axios from 'axios'

import { LEON_VERSION, NODEJS_BRIDGE_VERSION } from '@bridge/constants'

interface NetworkOptions {
  /**
   * `baseURL` will be prepended to `url`. It can be convenient to set `baseURL` for an instance of `Network` to pass relative URLs.
   */
  baseURL?: string
}

interface NetworkRequestOptions {
  /**
   * Server URL that will be used for the request.
   */
  url: string

  /**
   * Request method to be used when making the request.
   */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

  /**
   * Data to be sent as the request body.
   */
  data?: unknown

  /**
   * Custom headers to be sent.
   */
  headers?: Record<string, string>

  /**
   * HTTP inactivity timeout in milliseconds. The host owns overall execution limits.
   * Omitted preserves the client default.
   */
  timeoutMs?: number

  /**
   * Connect to a resolved IP while retaining the URL hostname for HTTPS.
   * Redirects are disabled for pinned requests; configured proxies keep owning DNS.
   */
  connectAddress?: string

  /**
   * Host-owned cancellation for an in-flight request.
   */
  signal?: AbortSignal

  /**
   * Optional files for multipart/form-data requests (parity with Python SDK).
   */
  files?: Record<string, unknown>

  /**
   * Whether to send JSON body (true by default). If false, send form data.
   */
  useJson?: boolean

  /**
   * Response type (defaults to 'json'). Use 'arraybuffer' for binary data like audio/video files.
   */
  responseType?:
    | 'json'
    | 'text'
    | 'arraybuffer'
    | 'blob'
    | 'document'
    | 'stream'
}

interface NetworkResponse<ResponseData> {
  /**
   * Data provided by the server.
   */
  data: ResponseData

  /**
   * HTTP status code from the server response, or 0 when no response was received.
   */
  statusCode: number

  /**
   * Options that was provided for the request.
   */
  options: NetworkRequestOptions & NetworkOptions
}

const formatErrorData = (data: unknown): string => {
  if (typeof data === 'string') {
    return data
  }

  try {
    return JSON.stringify(data)
  } catch {
    return String(data)
  }
}

/**
 * Reports an HTTP failure or the original cause when no response was received.
 */
export class NetworkError<ResponseErrorData = unknown> extends Error {
  public readonly response: NetworkResponse<ResponseErrorData>

  constructor(response: NetworkResponse<ResponseErrorData>, cause?: Error) {
    super(`[NetworkError]: ${cause?.message ?? response.statusCode}`, { cause })
    this.response = response
    Object.setPrototypeOf(this, NetworkError.prototype)
  }
}

export class Network {
  private readonly options: NetworkOptions
  private axios: AxiosInstance

  constructor(options: NetworkOptions = {}) {
    this.options = options
    this.axios = axios.create({
      baseURL: this.options.baseURL
    })
  }

  /**
   * Send HTTP request
   * @param options Request options
   * @example request({ url: '/send', method: 'POST', data: { message: 'Hi' } })
   */
  public async request<ResponseData = unknown, ResponseErrorData = unknown>(
    options: NetworkRequestOptions
  ): Promise<NetworkResponse<ResponseData>> {
    try {
      const address = options.connectAddress
      const family = address ? isIP(address) : 0
      const hostname = address
        ? new URL(this.axios.getUri({ url: options.url })).hostname
        : undefined

      if (address && !family) {
        throw new Error('The connection address must be an IP address.')
      }

      const response = await this.axios.request({
        url: options.url,
        method: options.method.toLowerCase(),
        // For parity, we accept any data type here (including FormData)
        data: options.data as never,
        responseType: options.responseType,
        timeout: options.timeoutMs,
        signal: options.signal,
        ...(address ? {
          // Only override origin resolution, never the configured proxy's address.
          lookup: async (host: string): Promise<dns.LookupAddress> => {
            return host === hostname
              ? { address, family }
              : dns.promises.lookup(host)
          },
          maxRedirects: 0,
          // A pooled socket might still point at the server we are avoiding.
          httpAgent: false,
          httpsAgent: false
        } : {}),
        headers: {
          'User-Agent': `Leon Personal Assistant ${LEON_VERSION} - Node.js Bridge ${NODEJS_BRIDGE_VERSION}`,
          ...options.headers
        }
      })

      let data = {} as ResponseData
      // For binary response types, return data as-is
      if (
        options.responseType === 'arraybuffer' ||
        options.responseType === 'blob' ||
        options.responseType === 'stream'
      ) {
        data = response.data as ResponseData
      } else {
        // For text/json responses, try to parse as JSON
        try {
          if (typeof response.data === 'string') {
            data = JSON.parse(response.data)
          } else {
            data = response.data as ResponseData
          }
        } catch {
          data = response.data as ResponseData
        }
      }

      return {
        data,
        statusCode: response.status,
        options: {
          ...this.options,
          ...options
        }
      }
    } catch (error) {
      // Transport failures have no HTTP status; preserve their actual cause.
      let statusCode = 0
      let dataRawText = ''

      if (axios.isAxiosError(error)) {
        dataRawText = error?.response?.data ?? ''
        statusCode = error?.response?.status ?? 0
      }

      let data: ResponseErrorData
      try {
        data = JSON.parse(dataRawText)
      } catch {
        data = dataRawText as ResponseErrorData
      }

      const response: NetworkResponse<ResponseErrorData> = {
        data,
        statusCode,
        options: {
          ...this.options,
          ...options
        }
      }

      console.error(
        '[NetworkError]',
        response.statusCode,
        options.method,
        options.url,
        error instanceof Error ? error.message : String(error),
        formatErrorData(response.data)
      )

      throw new NetworkError<ResponseErrorData>(
        response,
        statusCode === 0 && error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Check if error is a network error
   * @param error Error to check
   * @example isNetworkError(error) // false
   */
  public isNetworkError<ResponseErrorData = unknown>(
    error: unknown
  ): error is NetworkError<ResponseErrorData> {
    return error instanceof NetworkError
  }

  /**
   * Verify whether there is an Internet connectivity
   * @example isNetworkAvailable() // true
   */
  public async isNetworkAvailable(): Promise<boolean> {
    try {
      await dns.promises.resolve('getleon.ai')

      return true
    } catch {
      return false
    }
  }
}
