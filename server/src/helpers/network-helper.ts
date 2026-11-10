import { BlockList, isIP } from 'node:net'

import type { FileDownloader, DownloadFileOptions } from '@@/bridges/runtime/nodejs/file-downloader'
export type { DownloadFileOptions, DownloadFileProgress } from '@@/bridges/runtime/nodejs/file-downloader'

const HUGGING_FACE_URL = 'https://huggingface.co'
const HUGGING_FACE_MIRROR_URL = 'https://hf-mirror.com'
const PUBLIC_IPV6 = new BlockList()
const RESERVED_ADDRESSES = new BlockList()
const LOOPBACK_ADDRESSES = new BlockList()

LOOPBACK_ADDRESSES.addSubnet('127.0.0.0', 8, 'ipv4')
LOOPBACK_ADDRESSES.addAddress('::1', 'ipv6')
PUBLIC_IPV6.addSubnet('2000::', 3, 'ipv6')
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 3]
] as const) {
  RESERVED_ADDRESSES.addSubnet(address, prefix, 'ipv4')
}
RESERVED_ADDRESSES.addSubnet('2001::', 23, 'ipv6')
RESERVED_ADDRESSES.addSubnet('2001:db8::', 32, 'ipv6')
RESERVED_ADDRESSES.addSubnet('2002::', 16, 'ipv6')

/**
 * Shares address policy and host download facilities without loading download
 * or provider dependencies for callers that only validate a destination.
 */
export class NetworkHelper {
  private static downloader: typeof FileDownloader | undefined
  private static downloaderRequest: Promise<typeof FileDownloader> | undefined
  private static readonly preparing = new Set<{ error?: Error }>()

  /**
   * Identifies routable destinations before connecting to an untrusted hostname.
   */
  public static isPublicAddress(address: string): boolean {
    const family = isIP(address)
    if (family === 4) {
      return !RESERVED_ADDRESSES.check(address, 'ipv4')
    }

    return family === 6 && PUBLIC_IPV6.check(address, 'ipv6') &&
      !RESERVED_ADDRESSES.check(address, 'ipv6')
  }

  /**
   * Restricts explicitly local services to sockets on this machine.
   */
  public static isLoopbackAddress(address: string): boolean {
    const family = isIP(address)

    return family !== 0 && LOOPBACK_ADDRESSES.check(address, family === 4 ? 'ipv4' : 'ipv6')
  }

  /**
   * Downloads through the shared runtime implementation with Core-owned logging.
   * Cancellation also covers requests waiting for that implementation to load.
   */
  public static async downloadFile(fileURL: string, destinationPath: string, options?: DownloadFileOptions): Promise<void> {
    const pending: { error?: Error } = {}
    this.preparing.add(pending)
    let downloader: typeof FileDownloader
    try {
      downloader = await this.loadDownloader()
      if (pending.error) {
        throw pending.error
      }
    } finally {
      this.preparing.delete(pending)
    }

    await downloader.downloadFile(fileURL, destinationPath, options)
  }

  /**
   * Stops active downloads and prevents pending lazy initialization from starting
   * more work after setup has been cancelled.
   */
  public static abortActiveDownloads(reason = 'Download interrupted'): number {
    let count = this.downloader?.abortActiveDownloads(reason) ?? 0
    for (const pending of this.preparing) {
      if (!pending.error) {
        pending.error = new DOMException(reason, 'AbortError')
        count++
      }
    }

    return count
  }

  private static loadDownloader(): Promise<typeof FileDownloader> {
    this.downloaderRequest ??= Promise.all([
      import('@@/bridges/runtime/nodejs/file-downloader'),
      import('@/helpers/log-helper')
    ]).then(([{ FileDownloader }, { LogHelper }]) => {
      class CoreDownloader extends FileDownloader {
        protected static override warn(message: string): void {
          LogHelper.warning(message)
        }
      }
      this.downloader = CoreDownloader

      return CoreDownloader
    }).catch((error) => {
      this.downloaderRequest = undefined
      throw error
    })

    return this.downloaderRequest
  }

  /**
   * Checks provider reachability without loading its HTTP client for IP guards.
   */
  public static async canAccessHuggingFace(): Promise<boolean> {
    try {
      const { default: axios } = await import('axios')
      await axios.head(HUGGING_FACE_URL)

      return true
    } catch {
      return false
    }
  }

  /**
   * Selects the existing provider mirror when the main host is unreachable.
   */
  public static async setHuggingFaceURL(url: string): Promise<string> {
    if (!url.includes('huggingface.co')) {
      return url
    }
    if (!await NetworkHelper.canAccessHuggingFace()) {
      return url.replace(HUGGING_FACE_URL, HUGGING_FACE_MIRROR_URL)
    }

    return url
  }
}
