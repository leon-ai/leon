import { DESKTOP_CORE_PROTOCOL_VERSION } from '../../../bridges/runtime/contracts/desktop-client'
import contract from '../runtime/bootstrap-contract.mjs'
import { semver, RUNTIME_RELEASE_ASSET, selectRuntimeAsset, readRuntimeMetadata, runtimePlatform } from '../runtime/bootstrap-runtime.mjs'
import type { RuntimeAsset } from '../runtime/bootstrap-runtime.mjs'

export interface PublishedRuntime {
  draft: boolean
  prerelease: boolean
  tag_name: string
  assets?: { name: string }[]
}

/**
 * Separates an occupied incompatible server port from a server that is offline.
 */
export class CoreCompatibilityError extends Error {
  constructor(message: string, readonly coreVersion?: string) {
    super(message)
  }
}

/**
 * Checks the supported release range and the protocol spoken by the server.
 */
export function supportsCore(value: { version?: unknown, desktop_protocol_version?: unknown }): boolean {
  return typeof value.version === 'string' && Boolean(semver.valid(value.version)) &&
    semver.satisfies(value.version, contract.coreVersionRange, { includePrerelease: true }) &&
    value.desktop_protocol_version === DESKTOP_CORE_PROTOCOL_VERSION
}

/**
 * Rejects incompatible running servers before any profile content is requested.
 */
export function assertCoreCompatibility(value: { version?: unknown, desktop_protocol_version?: unknown }): void {
  if (!supportsCore(value)) {
    const coreVersion = typeof value.version === 'string' ? semver.valid(value.version) ?? undefined : undefined

    throw new CoreCompatibilityError(`I need a compatible Leon server (${contract.coreVersionRange}, desktop protocol ${DESKTOP_CORE_PROTOCOL_VERSION}). Update the server or use a matching desktop app.`, coreVersion)
  }
}

/**
 * Prevents a desktop-initiated server update from installing an incompatible host.
 * The server still owns release pinning, integrity checks, setup and restart.
 */
export async function assertCoreUpdateCompatibility(tag: string): Promise<void> {
  assertCoreCompatibility({ version: tag, desktop_protocol_version: DESKTOP_CORE_PROTOCOL_VERSION })
  const baseURL = `${contract.repository}/releases/download/${encodeURIComponent(tag)}/`
  const metadata = await readRuntimeMetadata(new URL(RUNTIME_RELEASE_ASSET, baseURL)) as {
    desktopProtocolVersion?: number
  }
  assertCoreCompatibility({ version: tag, desktop_protocol_version: metadata.desktopProtocolVersion })
  selectRuntimeAsset(metadata, semver.valid(tag)!, undefined, baseURL)
}

/**
 * Skips unsupported platforms/protocols before choosing a downloadable release.
 * Malformed manifests still fail closed instead of silently hiding tampering.
 */
export async function findCoreAsset(releases: PublishedRuntime[], readManifest: (url: URL) => Promise<unknown>,
  platform = runtimePlatform()): Promise<RuntimeAsset> {
  const candidates = releases.filter((item) => !item.draft && semver.valid(item.tag_name) &&
    (contract.channel === 'preview' || !item.prerelease && !item.tag_name.includes('-')) &&
    semver.satisfies(item.tag_name, contract.coreVersionRange, { includePrerelease: true }) &&
    item.assets?.some((asset) => asset.name === RUNTIME_RELEASE_ASSET))
    .sort((a, b) => semver.rcompare(a.tag_name, b.tag_name))

  for (const release of candidates) {
    const version = semver.valid(release.tag_name)!
    const name = `leon-core-${version}-${platform}.tar.gz`
    if (!release.assets?.some((asset) => asset.name === name)) {
      continue
    }
    const baseURL = `${contract.repository}/releases/download/${encodeURIComponent(release.tag_name)}/`
    const metadata = await readManifest(new URL(RUNTIME_RELEASE_ASSET, baseURL)) as {
      desktopProtocolVersion?: number
      assets?: { platform: string }[]
    }
    if (metadata.desktopProtocolVersion !== DESKTOP_CORE_PROTOCOL_VERSION ||
      !metadata.assets?.some((asset) => asset.platform === platform)) {
      continue
    }
    return selectRuntimeAsset(metadata, version, platform, baseURL)
  }
  throw new Error('No compatible prebuilt server release is published for this platform yet. I can retry after a release is published, or connect to a compatible running server.')
}
