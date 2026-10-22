import path from 'node:path'

const ARCHIVE_EXTENSIONS = ['.tar.gz', '.tar.xz', '.tgz', '.zip', '.tar']

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

  return path.join(toolkitsPath, toolkitId, 'assets', executable)
}
