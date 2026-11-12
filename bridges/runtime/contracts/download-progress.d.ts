export type DownloadStatus = 'queued' | 'downloading' | 'complete' | 'failed' | 'cancelled'

/**
 * Measured file transfer state shared by SDK producers and conversation views.
 * Identity is independent of the filename so resources can contain equal names.
 */
export interface FileDownloadProgress {
  id: string
  fileName: string
  status: DownloadStatus
  downloadedBytes: number
  totalBytes: number | null
  etaMs: number | null
  error?: string
}
