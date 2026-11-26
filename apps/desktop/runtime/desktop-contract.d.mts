import type { WebPreferenceKey } from '../../../bridges/runtime/contracts/desktop-client'

/**
 * Public attachment and preference limits serialized from their canonical owners.
 */
export interface DesktopContract {
  filesEvent: string
  filesPath: string
  updatesPath: string
  updatesMetaName: string
  profileCookieName: string
  preferenceKeys: WebPreferenceKey[]
  preferencePrefixes: string[]
  maximumFiles: number
  maximumBytes: number
  formats: { extensions: readonly string[], mediaType: string, maximumBytes: number }[]
}

declare const contract: DesktopContract
export default contract
