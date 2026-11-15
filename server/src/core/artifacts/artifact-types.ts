const DOWNLOAD_WHITESPACE_PATTERN = /\s/gu
const UNSAFE_FILENAME_CHARACTERS = new Set('<>:"/\\|?*')
const WINDOWS_DEVICE_NAME_PATTERN = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/iu

/**
 * Keeps artifact names portable and prevents Windows devices or alternate data
 * streams from being opened when an authenticated client supplies a filename.
 */
export function isPortableArtifactFilename(filename: string): boolean {
  return Boolean(filename) && filename.length <= 255 &&
    !filename.endsWith('.') && !filename.endsWith(' ') &&
    !WINDOWS_DEVICE_NAME_PATTERN.test(filename.split('.', 1)[0]!.trimEnd()) &&
    !Array.from(filename).some((character) => character.charCodeAt(0) < 32 ||
      character.charCodeAt(0) === 127 || UNSAFE_FILENAME_CHARACTERS.has(character))
}

/**
 * Gives downloaded artifacts portable names without renaming stored files
 * or changing their owner-visible titles. Shared by HTTP and browser actions.
 */
export function getArtifactDownloadFilename(filename: string): string {
  return filename.replaceAll(DOWNLOAD_WHITESPACE_PATTERN, '_')
}

/**
 * Portable artifact metadata. Paths and provider URLs never cross the client boundary.
 */
export interface Artifact {
  id: string
  session_id: string
  filename: string
  mime_type: string
  size_bytes: number
  created_at: number
  source: string
  url: string
}

/**
 * Explicit tool deliverable; evidence without this marker stays internal.
 */
export interface ArtifactFile {
  path: string
  filename: string
  mime_type: string
  presentation: 'attachment'
}
