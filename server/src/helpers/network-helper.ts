import { BlockList, isIP } from 'node:net'
import axios from 'axios'

import { FileDownloader } from '@@/bridges/runtime/nodejs/file-downloader'
import { LogHelper } from '@/helpers/log-helper'

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
 * Core download entry point with host logging and model-resource URL selection.
 */
export class NetworkHelper extends FileDownloader {
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
   * Keep transport warnings attached to Core's owning profile.
   */
  protected static override warn(message: string): void {
    LogHelper.warning(message)
  }

  /**
   * Check if the current network can access Hugging Face
   * @example canAccessHuggingFace() // true
   */
  public static async canAccessHuggingFace(): Promise<boolean> {
    try {
      await axios.head(HUGGING_FACE_URL)

      return true
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      return false
    }
  }

  /**
   * Set the Hugging Face URL based on the network access
   * @param url The URL to set
   * @example setHuggingFaceURL('https://huggingface.co') // https://hf-mirror.com
   */
  public static async setHuggingFaceURL(url: string): Promise<string> {
    if (!url.includes('huggingface.co')) {
      return url
    }

    const canAccess = await NetworkHelper.canAccessHuggingFace()

    if (!canAccess) {
      return url.replace(HUGGING_FACE_URL, HUGGING_FACE_MIRROR_URL)
    }

    return url
  }

}
