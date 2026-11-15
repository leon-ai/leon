const DOWNLOAD_WHITESPACE_PATTERN = /\s/gu

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
