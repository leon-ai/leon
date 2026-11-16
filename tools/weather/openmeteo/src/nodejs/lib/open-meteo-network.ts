import { lookup } from 'node:dns/promises'

import { Network, NetworkError } from '@sdk/network'

import { createDnsQuery, readDnsAddresses } from './dns-message'

const REQUEST_TIMEOUT_MS = 4_000
const DNS_TIMEOUT_MS = 1_500
const MAX_FALLBACK_ATTEMPTS = 2
const RETRYABLE_STATUSES = new Set([0, 500, 502, 503, 504])
// Interleave mainland and international services so either region can recover.
// Bootstrap public DNS without depending on the local resolver being healthy.
const DNS_ENDPOINTS = [
  { url: 'https://dns.alidns.com/dns-query', address: '223.5.5.5' },
  { url: 'https://cloudflare-dns.com/dns-query', address: '1.1.1.1' },
  { url: 'https://doh.pub/dns-query', address: '1.12.12.12' },
  { url: 'https://dns.google/dns-query', address: '8.8.8.8' }
]

interface Address {
  ip: string
  expiresAt: number
}

/**
 * Recover from an unhealthy regional Open-Meteo peer using alternate DNS answers.
 */
export class OpenMeteoNetwork {
  private readonly network: Network
  private readonly dnsNetwork = new Network()
  private readonly hostname: string
  private readonly cache = new Map<string, Address[]>()

  constructor(baseURL: string) {
    this.network = new Network({ baseURL })
    this.hostname = new URL(baseURL).hostname
  }

  /**
   * Keep discovery and retries inside the caller's shared execution budget.
   */
  public async get<T>(
    url: string,
    deadline: number,
    signal?: AbortSignal
  ): Promise<T> {
    const request = async (connectAddress?: string): Promise<T> => {
      const response = await this.network.request<T>({
        url,
        method: 'GET',
        timeoutMs: this.remainingTimeout(deadline, REQUEST_TIMEOUT_MS, signal),
        ...(connectAddress ? { connectAddress } : {}),
        ...(signal ? { signal } : {})
      })

      return response.data
    }

    let failure: unknown
    try {
      return await request()
    } catch (error) {
      if (!this.isRetryable(error)) {
        throw error
      }
      failure = error
    }

    // Exclude the system resolver's peers, including the one that just failed.
    const tried = new Set<string>()
    try {
      const addresses = await lookup(this.hostname, { all: true })
      for (const address of addresses) {
        tried.add(address.address)
      }
    } catch {
      // Alternate DNS can also recover when local name resolution is unavailable.
    }

    let attempts = 0
    for (const endpoint of DNS_ENDPOINTS) {
      this.remainingTimeout(deadline, DNS_TIMEOUT_MS, signal)
      let addresses: Address[]
      try {
        addresses = await this.resolve(endpoint, deadline, signal)
      } catch {
        // Resolver outages must not hide the original weather failure.
        continue
      }

      for (const address of addresses) {
        if (tried.has(address.ip)) {
          continue
        }
        tried.add(address.ip)
        attempts += 1
        try {
          return await request(address.ip)
        } catch (error) {
          if (!this.isRetryable(error)) {
            throw error
          }
          failure = error
        }
        if (attempts >= MAX_FALLBACK_ATTEMPTS) {
          throw failure
        }
      }
    }

    throw failure
  }

  private isRetryable(error: unknown): boolean {
    return error instanceof NetworkError &&
      RETRYABLE_STATUSES.has(error.response.statusCode)
  }

  private remainingTimeout(
    deadline: number,
    limit: number,
    signal?: AbortSignal
  ): number {
    signal?.throwIfAborted()
    const remaining = deadline - performance.now()
    if (remaining <= 0) {
      throw new Error('Weather request deadline exceeded.')
    }

    return Math.max(1, Math.min(limit, Math.floor(remaining)))
  }

  private async resolve(
    endpoint: (typeof DNS_ENDPOINTS)[number],
    deadline: number,
    signal?: AbortSignal
  ): Promise<Address[]> {
    const cached = this.cache.get(endpoint.url)?.filter(
      (entry) => entry.expiresAt > performance.now()
    )
    if (cached?.length) {
      return cached
    }

    // Public resolvers receive only the hostname, never the owner's location/query.
    const query = createDnsQuery(this.hostname)
    const response = await this.dnsNetwork.request<Buffer>({
      url: `${endpoint.url}?dns=${query.toString('base64url')}`,
      method: 'GET',
      connectAddress: endpoint.address,
      headers: { Accept: 'application/dns-message' },
      responseType: 'arraybuffer',
      timeoutMs: this.remainingTimeout(deadline, DNS_TIMEOUT_MS, signal),
      ...(signal ? { signal } : {})
    })
    const addresses = readDnsAddresses(response.data, query).map((entry) => ({
      ip: entry.ip,
      expiresAt: performance.now() + entry.ttl * 1_000
    }))

    this.cache.set(endpoint.url, addresses)
    return addresses
  }
}
