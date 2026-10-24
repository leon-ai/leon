import { platform, arch, cpus } from 'node:os'

/**
 * Platform utilities for consistent platform and architecture detection
 * Matches the naming convention from system-helper.ts BinaryFolderNames enum
 */

/**
 * Get platform name with architecture granularity (matches system-helper.ts)
 * Returns same format as BinaryFolderNames enum from system-helper.ts
 */
export function getPlatformName(): string {
  const platformName = platform()
  const cpuArchitecture = arch()

  if (platformName === 'linux') {
    if (cpuArchitecture === 'x64') {
      return 'linux-x86_64'
    }

    return 'linux-aarch64'
  }

  if (platformName === 'darwin') {
    const cpuCores = cpus()
    const isM1 = cpuCores[0]?.model.includes('Apple')

    if (isM1 || cpuArchitecture === 'arm64') {
      return 'macosx-arm64'
    }

    return 'macosx-x86_64'
  }

  if (platformName === 'win32') {
    return 'win-amd64'
  }

  return 'unknown'
}

/**
 * Check if current platform is Windows
 * @returns True if running on Windows, false otherwise
 * @example if (isWindows()) { executableName += '.exe' }
 */
export function isWindows(): boolean {
  return getPlatformName().startsWith('win')
}

/**
 * Check if current platform is macOS
 * @returns True if running on macOS, false otherwise
 * @example if (isMacOS()) { await removeQuarantineAttribute(binaryPath) }
 */
export function isMacOS(): boolean {
  return getPlatformName().startsWith('macosx')
}

/**
 * Check if current platform is Linux
 * @returns True if running on Linux, false otherwise
 * @example if (isLinux()) { await checkSystemPackage('ffmpeg') }
 */
export function isLinux(): boolean {
  return getPlatformName().startsWith('linux')
}

