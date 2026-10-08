import { platform, arch, cpus } from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import axios from 'axios'

const HUGGING_FACE_URL = 'https://huggingface.co'
const HUGGING_FACE_MIRROR_URL = 'https://hf-mirror.com'
const ZIP_ARCHIVE_EXTENSIONS = new Set(['.zip', '.whl'])

/**
 * Formats a file path as a clickable path with proper delimiters
 * @param filePath The absolute file path to format
 * @returns A formatted string that the client can detect and make clickable
 * @example formatFilePath('/Users/john/video.mp4') // returns '[FILE_PATH]/Users/john/video.mp4[/FILE_PATH]'
 */
export function formatFilePath(filePath: string): string {
  return `[FILE_PATH]${filePath}[/FILE_PATH]`
}

/**
 * Formats multiple file paths as a list of clickable paths
 * @param filePaths Array of absolute file paths
 * @returns A formatted string with multiple clickable paths
 * @example formatFilePaths(['/path1', '/path2']) // returns '[FILE_PATH]/path1[/FILE_PATH], [FILE_PATH]/path2[/FILE_PATH]'
 */
export function formatFilePaths(filePaths: string[]): string {
  return filePaths.map(formatFilePath).join(', ')
}

/**
 * Normalize a language input to an ISO 639-1 code.
 * Supports direct language codes and locale tags such as `fr-FR`.
 */
export function normalizeLanguageCode(value: string): string | null {
  const trimmedValue = value.trim()

  if (trimmedValue === '') {
    return null
  }

  try {
    const locale = new Intl.Locale(trimmedValue)

    return locale.language ? locale.language.toLowerCase() : null
  } catch {
    const normalizedValue = trimmedValue.toLowerCase()

    if (
      normalizedValue.length === 2 &&
      [...normalizedValue].every((char) => char >= 'a' && char <= 'z')
    ) {
      return normalizedValue
    }

    return null
  }
}

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

/**
 * Check if the current network can access Hugging Face
 * @example canAccessHuggingFace() // true
 */
export async function canAccessHuggingFace(): Promise<boolean> {
  try {
    await axios.head(HUGGING_FACE_URL, { timeout: 5000 })
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
export async function setHuggingFaceURL(url: string): Promise<string> {
  if (!url.includes('huggingface.co')) {
    return url
  }

  const canAccess = await canAccessHuggingFace()

  if (!canAccess) {
    return url.replace(HUGGING_FACE_URL, HUGGING_FACE_MIRROR_URL)
  }

  return url
}

/**
 * Format bytes into human-readable units
 * @param bytes The number of bytes to format
 * @returns A human-readable string representation
 * @example formatBytes(1024) // "1 KB"
 * @example formatBytes(1536) // "1.5 KB"
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return '0 B'
  }

  const k = 1_024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/**
 * Format speed from raw number to human-readable format
 * @param speed The speed in bytes per second (or already formatted string)
 * @returns A human-readable speed string
 * @example formatSpeed(1_024) // "1 KB/s"
 * @example formatSpeed("1.5 MB/s") // "1.5 MB/s" (already formatted)
 */
export function formatSpeed(speed: string | number): string {
  if (typeof speed === 'string') {
    // If it's already formatted (e.g., "1.5 MB/s"), return as is
    if (speed.includes('/s')) {
      return speed
    }
    // If it's a string number, convert to number
    speed = parseFloat(speed)
  }
  if (isNaN(speed) || speed === 0) {
    return '0 B/s'
  }

  // Assume speed is in bytes per second
  return formatBytes(speed) + '/s'
}

/**
 * Format ETA from seconds to human-readable format
 * @param eta The ETA in seconds (or already formatted string)
 * @returns A human-readable ETA string
 * @example formatETA(3661) // "1h 1m 1s"
 * @example formatETA(90) // "1m 30s"
 * @example formatETA("00:01:30") // "1m 30s" (parsed from HH:MM:SS)
 */
export function formatETA(eta: string | number): string {
  if (typeof eta === 'string') {
    // If it's already formatted (e.g., "00:02:45"), return as is
    if (eta.includes(':')) {
      return eta
    }
    // If it's a string number, convert to number
    eta = parseFloat(eta)
  }

  if (isNaN(eta) || eta <= 0) {
    return '∞'
  }

  const hours = Math.floor(eta / 3_600)
  const minutes = Math.floor((eta % 3_600) / 60)
  const seconds = Math.floor(eta % 60)

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }

  return `${seconds}s`
}

/**
 * Extract archive file using native system commands
 * Supports .zip, .tar, .tar.gz, .tar.xz, .tgz formats across all platforms
 * @param archivePath The path to the archive file
 * @param targetPath The path to extract to
 * @param options Extraction options
 * @example extractArchive('archive.zip', 'output/dir')
 * @example extractArchive('archive.tar.xz', 'output/dir', { stripComponents: 1 })
 */
export async function extractArchive(
  archivePath: string,
  targetPath: string,
  options?: {
    stripComponents?: number
  }
): Promise<void> {
  const stripComponents = options?.stripComponents ?? 0

  // Ensure target directory exists
  await fs.promises.mkdir(targetPath, { recursive: true })

  const ext = path.extname(archivePath).toLowerCase()
  const basename = path.basename(archivePath).toLowerCase()

  try {
    if (ZIP_ARCHIVE_EXTENSIONS.has(ext)) {
      if (isWindows()) {
        execFileSync('tar', ['-xf', archivePath, '-C', targetPath], {
          stdio: 'inherit',
          windowsHide: true
        })
      } else {
        execFileSync('unzip', ['-o', '-q', archivePath, '-d', targetPath], {
          stdio: 'inherit',
          windowsHide: true
        })
      }
    } else if (
      basename.endsWith('.tar.gz') ||
      basename.endsWith('.tar.xz') ||
      basename.endsWith('.tgz') ||
      ext === '.tar'
    ) {
      const tarArgs = ['-xf', archivePath, '-C', targetPath]

      if (stripComponents > 0) {
        tarArgs.push(`--strip-components=${stripComponents}`)
      }

      execFileSync('tar', tarArgs, {
        stdio: 'inherit',
        windowsHide: true
      })
    } else {
      throw new Error(`Unsupported archive format: ${archivePath}`)
    }
  } catch (error) {
    throw new Error(
      `Failed to extract archive "${archivePath}": ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}
