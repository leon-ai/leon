import path from 'node:path'

import type { FileDownloadProgress } from '@@/bridges/runtime/contracts/download-progress'
import type { ToolExecutionContext } from '@@/bridges/runtime/contracts/tool-runtime-types'
import { FileDownloader } from '@@/bridges/runtime/nodejs/file-downloader'

const PROGRESS_INTERVAL_MS = 1_000

export interface DownloadFile {
  url: string
  path: string
}

/**
 * Reports a call's declared files and measured transfers through its host context.
 */
export class DownloadTracker {
  private readonly files = new Map<string, FileDownloadProgress>()

  constructor(
    private readonly context: ToolExecutionContext | null,
    private readonly logProgress?: (progress: FileDownloadProgress) => void
  ) {}

  /**
   * Publishes the known worklist before any transfer starts.
   */
  public queue(files: DownloadFile[]): void {
    for (const file of files) {
      if (!this.files.has(file.path)) {
        this.files.set(file.path, {
          id: file.path,
          fileName: path.basename(file.path),
          status: 'queued',
          downloadedBytes: 0,
          totalBytes: null,
          etaMs: null
        })
      }
    }

    this.publish(false)
  }

  private publish(activity: boolean): void {
    this.context?.onProgress?.({
      source: 'report',
      message: 'File download progress.',
      activity,
      downloads: Array.from(this.files.values())
    })
  }

  /**
   * Uses the shared resumable downloader while retaining the public file identity.
   * A staging destination lets tools publish downloaded files without clobbering data.
   */
  public async download(
    file: DownloadFile,
    options: {
      destination?: string
      signal?: AbortSignal
    } = {}
  ): Promise<void> {
    if (!this.files.has(file.path)) {
      this.queue([file])
    }

    let current = this.files.get(file.path)!
    let reportedBytes = current.downloadedBytes
    let lastPublishedAt = 0
    const update = (progress: Partial<FileDownloadProgress>, activity = false): void => {
      current = { ...current, ...progress }
      this.files.set(file.path, current)
      this.publish(activity)
      if (!this.context?.onProgress) {
        this.logProgress?.(current)
      }
    }

    update({ status: 'downloading' })

    try {
      await FileDownloader.downloadFile(file.url, options.destination ?? file.path, {
        cliProgress: false,
        ...(options.signal ? { signal: options.signal } : {}),
        onProgress: (progress) => {
          current = {
            ...current,
            downloadedBytes: progress.downloadedBytes,
            totalBytes: progress.totalBytes,
            etaMs: progress.etaMs
          }

          if (Date.now() - lastPublishedAt >= PROGRESS_INTERVAL_MS) {
            lastPublishedAt = Date.now()
            update({}, progress.downloadedBytes > reportedBytes)
            reportedBytes = progress.downloadedBytes
          }
        }
      })

      update({ status: 'complete', etaMs: null }, current.downloadedBytes > reportedBytes)
    } catch (error) {
      update({
        status: options.signal?.aborted ? 'cancelled' : 'failed',
        etaMs: null,
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }
}
