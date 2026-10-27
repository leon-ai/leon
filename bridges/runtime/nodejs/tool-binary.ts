import path from 'node:path'
import { createHash } from 'node:crypto'

const ARCHIVE_EXTENSIONS = ['.tar.gz', '.tar.xz', '.tgz', '.zip', '.tar']
const VERSIONED_FILENAME_PATTERN = /\d+\.\d+\.\d+/
const SOURCE_HASH_LENGTH = 12

/**
 * Resolves a declared tool executable without downloading or loading its runtime.
 */
export function resolveToolBinaryPath(
  toolkitsPath: string,
  toolkitId: string,
  binaryUrl: string,
  windows = process.platform === 'win32'
): string {
  let executable = path.basename(new URL(binaryUrl).pathname)

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

  return path.join(toolkitsPath, toolkitId, 'assets', executable)
}
