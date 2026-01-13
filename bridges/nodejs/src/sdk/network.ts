import dns from 'node:dns'

import type { AxiosInstance } from 'axios'
import axios from 'axios'

import { LEON_VERSION, NODEJS_BRIDGE_VERSION } from '@bridge/constants'

interface NetworkOptions {
  /** `baseURL` will be prepended to `url`. It can be convenient to set `baseURL` for an instance of `Network` to pass relative URLs. */
  baseURL?: string
}

interface NetworkRequestOptions {
  /** Server URL that will be used for the request. */
  url: string

  /** Request method to be used when making the request. */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

  /** Data to be sent as the request body. */
  data?: unknown

  /** Custom headers to be sent. */
  headers?: Record<string, string>

  /** Optional files for multipart/form-data requests (parity with Python SDK). */
  files?: Record<string, unknown>

  /** Whether to send JSON body (true by default). If false, send form data. */
  useJson?: boolean

  /** Response type (defaults to 'json'). Use 'arraybuffer' for binary data like audio/video files. */
  responseType?:
    | 'json'
    | 'text'
    | 'arraybuffer'
    | 'blob'
    | 'document'
    | 'stream'
}

interface NetworkResponse<ResponseData> {
  /** Data provided by the server. */
  data: ResponseData

  /** HTTP status code from the server response. */
  statusCode: number

  /** Options that was provided for the request. */
  options: NetworkRequestOptions & NetworkOptions
}

export class NetworkError<ResponseErrorData = unknown> extends Error {
  public readonly response: NetworkResponse<ResponseErrorData>

  constructor(response: NetworkResponse<ResponseErrorData>) {
    super(`[NetworkError]: ${response.statusCode} ${response.data}`)
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
      const response = await this.axios.request({
        url: options.url,
        method: options.method.toLowerCase(),
        // For parity, we accept any data type here (including FormData)
        data: options.data as never,
        responseType: options.responseType,
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
      let statusCode = 500
      let dataRawText = ''

      if (axios.isAxiosError(error)) {
        dataRawText = error?.response?.data ?? ''
        statusCode = error?.response?.status ?? 500
      }

      let data: ResponseErrorData
      try {
        data = JSON.parse(dataRawText)
      } catch {
        data = dataRawText as ResponseErrorData
      }

      throw new NetworkError<ResponseErrorData>({
        data,
        statusCode,
        options: {
          ...this.options,
          ...options
        }
      })
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
