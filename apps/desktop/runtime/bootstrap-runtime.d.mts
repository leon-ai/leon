import type { FileDownloader } from '../../../bridges/runtime/nodejs/file-downloader'
import type { RuntimeUpdateJob } from '../../../bridges/runtime/contracts/updates'

export { FileDownloader } from '../../../bridges/runtime/nodejs/file-downloader'
export { LEON_HOME_PATH, LEON_PROFILE_NAME, isValidProfileName } from '../../../server/src/leon-roots'
/**
 * Resolves the current profile without importing profile services into the host.
 */
export function getProfilePaths(): { config: string, dotEnv: string }
export { JsonRedactionHelper } from '../../../server/src/helpers/json-redaction-helper'
export { getUpdateStatePath } from '../../../scripts/update/paths.js'
export { UPDATE_CHECK_INTERVAL_MS, UPDATE_CHECK_JITTER_MS, UPDATE_STAGE_LABELS } from '../../../bridges/runtime/contracts/update-status.js'
export { writeRuntimeJSON } from '../../../scripts/distribution/runtime.js'
export { default as YAML } from 'yaml'
export { default as dotenv } from 'dotenv'

export type RuntimeAsset = RuntimeUpdateJob['asset']

/**
 * A validated version-local Core archive, independent of owner profile data.
 */
export interface CoreRuntime {
  root: string
  node: string
  pnpm: string
  setup: string
  entry: string
  frontend: string
  manifest: { version: string, platform: string, desktopProtocolVersion?: number }
}

export const RUNTIME_RELEASE_ASSET: string
/**
 * Uses the canonical platform names shared with archive publishing and Core OTA.
 */
export function runtimePlatform(): string
export const semver: {
  valid: (version: string) => string | null
  gt: (version: string, other: string) => boolean
  satisfies: (version: string, range: string, options: { includePrerelease: boolean }) => boolean
  rcompare: (left: string, right: string) => number
}
/**
 * Reads bounded release metadata before selecting an immutable platform asset.
 */
export function readRuntimeMetadata(url: string | URL, options?: { signal?: AbortSignal }): Promise<unknown>
/**
 * Validates the platform, version, size and checksum of a reviewed Core asset.
 */
export function selectRuntimeAsset(manifest: unknown, version: string, platform?: string, baseURL?: string): RuntimeAsset
/**
 * Resolves the validated active Core version and its bundled runtime paths.
 */
export function currentRuntime(installation: string): Promise<CoreRuntime>
/**
 * Atomically selects a prepared version without moving owner profile data.
 */
export function activateRuntime(installation: string, version: string): Promise<void>
/**
 * Serializes native installation and returns an explicit lock release operation.
 */
export function acquireRuntimeLock(filename: string): Promise<() => Promise<void>>
/**
 * Binds a Core process to its version-local runtimes and managed home.
 */
export function runtimeEnvironment(runtime: CoreRuntime, installation: string): NodeJS.ProcessEnv
/**
 * Verifies and extracts an archive while reporting real advancing work.
 */
export function installRuntimeArchive(options: {
  installation: string
  asset: RuntimeAsset
  signal?: AbortSignal
  download: typeof FileDownloader.downloadFile
  onStage: (stage: 'downloading' | 'verifying' | 'extracting') => void
  onProgress: (progress: { downloadedBytes: number, totalBytes: number | null }) => void
}): Promise<CoreRuntime>
