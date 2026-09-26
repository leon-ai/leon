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
