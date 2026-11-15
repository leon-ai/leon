import path from 'node:path'
import { createHash } from 'node:crypto'
import type { ToolBinary } from '../contracts/tool-binary'

const ARCHIVE_EXTENSIONS = ['.tar.gz', '.tar.xz', '.tgz', '.zip', '.tar']
const VERSIONED_FILENAME_PATTERN = /\d+\.\d+\.\d+/
const SOURCE_HASH_LENGTH = 12

/**
 * Resolves a declared tool executable without downloading or loading its runtime.
 */
export function resolveToolBinaryPath(
  toolkitsPath: string,
  toolkitId: string,
  binary: ToolBinary,
  windows = process.platform === 'win32'
): string {
  const installationPath = resolveToolBinaryInstallationPath(
    toolkitsPath, toolkitId, binary, windows
  )

  return typeof binary !== 'string' && binary.executable !== undefined
    ? path.join(installationPath, normalizeToolBinaryEntrypoint(binary.executable))
    : installationPath
}

/**
 * Validates an archive entrypoint independently of the host's path separators.
 */
export function normalizeToolBinaryEntrypoint(entrypoint: string): string {
  const normalized = entrypoint.replace(/\\/g, '/')
  const segments = normalized.split('/')

  if (
    !normalized.trim() ||
    normalized.includes('\0') ||
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(normalized) ||
    /^[a-z]:/i.test(normalized) ||
    segments.some((segment) => segment === '..') ||
    segments.every((segment) => segment === '' || segment === '.')
  ) {
    throw new Error('Binary executable must be a relative archive path without parent segments')
  }

  return path.join(...segments)
}

/**
 * Resolves the atomic installation target: a single file or a complete bundle.
 */
export function resolveToolBinaryInstallationPath(
  toolkitsPath: string,
  toolkitId: string,
  binary: ToolBinary,
  windows = process.platform === 'win32'
): string {
  const binaryUrl = typeof binary === 'string' ? binary : binary.url
  let executable = path.basename(new URL(binaryUrl).pathname)

  if (typeof binary !== 'string' && binary.executable !== undefined) {
    normalizeToolBinaryEntrypoint(binary.executable)
  }

  for (const extension of ARCHIVE_EXTENSIONS) {
    if (executable.toLowerCase().endsWith(extension)) {
      executable = executable.slice(0, -extension.length)
      break
    }
  }

  if (windows && !executable.endsWith('.exe')) {
    executable = `${executable}.exe`
  }

  // Versionless assets need source identity to distinguish releases. Preserve
  // existing cache paths when the asset already includes a version.
  if (!VERSIONED_FILENAME_PATTERN.test(executable)) {
    const suffix = windows ? '.exe' : ''
    const name = suffix ? executable.slice(0, -suffix.length) : executable
    const source = createHash('sha256')
      .update(binaryUrl)
      .digest('hex')
      .slice(0, SOURCE_HASH_LENGTH)
    executable = `${name}-${source}${suffix}`
  }

  if (typeof binary !== 'string') {
    const source = createHash('sha256')
      .update([binary.url, binary.executable ?? '', binary.sha256 ?? ''].join('\0'))
      .digest('hex')
      .slice(0, SOURCE_HASH_LENGTH)
    const bundle = binary.executable !== undefined
    const suffix = windows && !bundle ? '.exe' : ''
    const name = suffix ? executable.slice(0, -suffix.length) : executable
    executable = `${name}-${source}${bundle ? '.bundle' : suffix}`
  }

  return path.join(toolkitsPath, toolkitId, 'assets', executable)
}
