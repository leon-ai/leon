import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

import axios from 'axios'

import { LogHelper } from '@/helpers/log-helper'

const HUGGING_FACE_URL = 'https://huggingface.co'
const HUGGING_FACE_MIRROR_URL = 'https://hf-mirror.com'
const PARALLEL_DOWNLOAD_MIN_BYTES = 128 * 1_024 * 1_024
const PARALLEL_DOWNLOAD_MIN_RANGE_BYTES = 16 * 1_024 * 1_024
const DOWNLOAD_INACTIVITY_TIMEOUT_MS = 30_000
const PARALLEL_DOWNLOAD_CHECKPOINT_BYTES = 64 * 1_024 * 1_024
const PARALLEL_DOWNLOAD_STATE_VERSION = 1
const DOWNLOAD_PROGRESS_SPINNER_COLOR_START = '\x1b[36m'
const DOWNLOAD_PROGRESS_SPINNER_COLOR_END = '\x1b[39m'
const DOWNLOAD_PROGRESS_SPINNER_FRAMES = [
  '⣾',
  '⣽',
  '⣻',
  '⢿',
  '⡿',
  '⣟',
  '⣯',
  '⣷'
]
const DOWNLOAD_PROGRESS_SPINNER_INTERVAL_MS = 80
const SETUP_DOWNLOAD_PROGRESS_START_EVENT = 'leon:setup-download-progress:start'
const SETUP_DOWNLOAD_PROGRESS_END_EVENT = 'leon:setup-download-progress:end'
const MOVE_FALLBACK_ERROR_CODES = new Set(['EXDEV', 'EPERM', 'EBUSY', 'EACCES'])

export interface DownloadFileOptions {
  cliProgress?: boolean
  inactivityTimeoutMs?: number
  onProgress?: (progress: DownloadFileProgress) => void
  parallelStreams?: number
  skipExisting?: boolean
  retry?: {
    retries?: number
    factor?: number
    minTimeout?: number
    maxTimeout?: number
  }
  retryFetchDownloadInfo?: {
    retries?: number
    factor?: number
    minTimeout?: number
    maxTimeout?: number
  }
}

export interface DownloadFileProgress {
  downloadedBytes: number
  totalBytes: number | null
  percentage: number | null
  bytesPerSecond: number
  etaMs: number | null
}

interface DownloadProbe {
  totalBytes: number | null
  acceptRanges: boolean
}

interface ParallelDownloadRange {
  start: number
  end: number
  position: number
}

interface ParallelDownloadState {
  version: typeof PARALLEL_DOWNLOAD_STATE_VERSION
  fileURL: string
  totalBytes: number
  ranges: ParallelDownloadRange[]
}

interface ProgressReporter {
  update: (downloadedBytes: number) => void
  finish: (downloadedBytes: number) => void
  fail: () => void
}

type RetryOptions = Required<NonNullable<DownloadFileOptions['retry']>>
type DownloadInfoRetryOptions = Required<
  NonNullable<DownloadFileOptions['retryFetchDownloadInfo']>
>
type ResolvedDownloadFileOptions = Omit<
  Required<DownloadFileOptions>,
  'retry' | 'retryFetchDownloadInfo' | 'onProgress'
> & {
  onProgress?: DownloadFileOptions['onProgress']
  retry: RetryOptions
  retryFetchDownloadInfo: DownloadInfoRetryOptions
}

export class NetworkHelper {
  private static readonly activeDownloadControllers = new Set<AbortController>()

  private static readonly DEFAULT_DOWNLOAD_OPTIONS: ResolvedDownloadFileOptions =
    {
      cliProgress: true,
      inactivityTimeoutMs: DOWNLOAD_INACTIVITY_TIMEOUT_MS,
      parallelStreams: 3,
      skipExisting: false,
      retry: {
        retries: 2,
        factor: 1.5,
        minTimeout: 300,
        maxTimeout: 2_000
      },
      retryFetchDownloadInfo: {
        retries: 1,
        factor: 1.5,
        minTimeout: 300,
        maxTimeout: 1_000
      }
    }

  private static createAbortError(
    message = 'Download aborted'
  ): Error {
    const error = new Error(message)
    error.name = 'AbortError'

    return error
  }

  private static createInactivityController(
    parentSignal: AbortSignal | undefined,
    inactivityTimeoutMs: number
  ): {
    signal: AbortSignal
    refresh: () => void
    dispose: () => void
  } {
    const controller = new AbortController()
    let timeoutId: NodeJS.Timeout | null = null
    const abortFromParent = (): void => {
      controller.abort(parentSignal?.reason)
    }
    const refresh = (): void => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      timeoutId = setTimeout(() => {
        controller.abort(
          new Error(`Download stalled for ${inactivityTimeoutMs}ms`)
        )
      }, inactivityTimeoutMs)
      timeoutId.unref?.()
    }
    const dispose = (): void => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }

      parentSignal?.removeEventListener('abort', abortFromParent)
    }

    if (parentSignal?.aborted) {
      abortFromParent()
    } else {
      parentSignal?.addEventListener('abort', abortFromParent, { once: true })
    }
    refresh()

    return {
      signal: controller.signal,
      refresh,
      dispose
    }
  }

  private static throwIfAborted(signal?: AbortSignal): void {
    if (!signal?.aborted) {
      return
    }

    throw signal.reason instanceof Error
      ? signal.reason
      : this.createAbortError()
  }

  private static isAbortError(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.name === 'AbortError' ||
        ('code' in error && error.code === 'ABORT_ERR'))
    )
  }

  private static isMoveFallbackError(
    error: unknown
  ): error is NodeJS.ErrnoException {
    return (
      error instanceof Error &&
      'code' in error &&
      typeof error.code === 'string' &&
      MOVE_FALLBACK_ERROR_CODES.has(error.code)
    )
  }

  private static formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let value = bytes
    let unitIndex = 0

    while (value >= 1_024 && unitIndex < units.length - 1) {
      value /= 1_024
      unitIndex += 1
    }

    return `${value.toFixed(unitIndex === 0 ? 0 : 2)}${units[unitIndex]}`
  }

  private static formatDuration(durationMs: number): string {
    const totalSeconds = Math.max(0, Math.round(durationMs / 1_000))
    const hours = Math.floor(totalSeconds / 3_600)
    const minutes = Math.floor((totalSeconds % 3_600) / 60)
    const seconds = totalSeconds % 60

    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`
    }

    if (minutes > 0) {
      return `${minutes}m ${seconds}s`
    }

    return `${seconds}s`
  }

  private static sleep(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, delayMs)
    })
  }

  private static isRemoteURL(fileURL: string): boolean {
    try {
      const parsedURL = new URL(fileURL)

      return parsedURL.protocol === 'http:' || parsedURL.protocol === 'https:'
    } catch {
      return false
    }
  }

  private static parseContentLength(value: string | null): number | null {
    if (!value) {
      return null
    }

    const parsedValue = Number(value)

    return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : null
  }

  private static parseContentRangeTotalBytes(value: string | null): number | null {
    if (!value) {
      return null
    }

    const match = value.match(/bytes\s+\d+-\d+\/(\d+|\*)/i)

    const totalBytesValue = match?.[1]

    if (!totalBytesValue || totalBytesValue === '*') {
      return null
    }

    return this.parseContentLength(totalBytesValue)
  }

  private static async movePath(
    sourcePath: string,
    destinationPath: string
  ): Promise<void> {
    try {
      await fs.promises.rename(sourcePath, destinationPath)
    } catch (error) {
      if (!this.isMoveFallbackError(error)) {
        throw error
      }

      await fs.promises.cp(sourcePath, destinationPath, {
        force: true
      })
      await fs.promises.rm(sourcePath, { force: true })
    }
  }

  private static async ensureDownloadedFilePath(
    destinationPath: string
  ): Promise<void> {
    const finalPath = path.resolve(destinationPath)

    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        const stat = await fs.promises.stat(finalPath)

        if (stat.isFile()) {
          return
        }
      } catch {
        // Retry briefly while the final file path becomes visible on disk.
      }

      await this.sleep(100)
    }

    throw new Error(
      `Downloaded file is not available at "${finalPath}" after completion.`
    )
  }

  private static createProgressReporter(
    destinationPath: string,
    options: ResolvedDownloadFileOptions,
    totalBytes?: number
  ): ProgressReporter {
    if (!options.cliProgress && !options.onProgress) {
      return {
        update: (): void => {},
        finish: (): void => {},
        fail: (): void => {}
      }
    }

    const fileName = path.basename(destinationPath)
    const startedAt = Date.now()
    const isTTY = process.stdout.isTTY
    const renderIntervalMs = isTTY ? 200 : 5_000
    const shouldEmitSetupDownloadProgressEvents = options.cliProgress
    let lastRenderAt = 0
    let didEmitSetupDownloadProgressStart = false
    let initialDownloadedBytes: number | null = null
    let transferStartedAt = startedAt

    if (options.cliProgress) {
      process.emit(SETUP_DOWNLOAD_PROGRESS_START_EVENT)
      didEmitSetupDownloadProgressStart = true
      console.log('')
      console.log(fileName)
    }

    const createProgressSnapshot = (
      downloadedBytes: number
    ): DownloadFileProgress => {
      if (initialDownloadedBytes === null) {
        initialDownloadedBytes = downloadedBytes
        transferStartedAt = Date.now()
      }

      const elapsedMs = Math.max(1, Date.now() - transferStartedAt)
      const transferredBytes = Math.max(
        0,
        downloadedBytes - initialDownloadedBytes
      )
      const bytesPerSecond = transferredBytes / (elapsedMs / 1_000)
      const etaMs =
        typeof totalBytes === 'number' &&
        totalBytes > downloadedBytes &&
        bytesPerSecond > 0
          ? ((totalBytes - downloadedBytes) / bytesPerSecond) * 1_000
          : null

      return {
        downloadedBytes,
        totalBytes: totalBytes ?? null,
        percentage:
          typeof totalBytes === 'number' && totalBytes > 0
            ? (downloadedBytes / totalBytes) * 100
            : null,
        bytesPerSecond,
        etaMs
      }
    }

    const render = (downloadedBytes: number, force = false): void => {
      const progress = createProgressSnapshot(downloadedBytes)
      const now = Date.now()

      if (options.onProgress) {
        options.onProgress(progress)
      }

      if (!options.cliProgress) {
        return
      }

      if (!force && now - lastRenderAt < renderIntervalMs) {
        return
      }

      lastRenderAt = now
      const spinnerFrame =
        DOWNLOAD_PROGRESS_SPINNER_FRAMES[
          Math.floor(
            (now - startedAt) / DOWNLOAD_PROGRESS_SPINNER_INTERVAL_MS
          ) % DOWNLOAD_PROGRESS_SPINNER_FRAMES.length
        ]
      const coloredSpinnerFrame = `${DOWNLOAD_PROGRESS_SPINNER_COLOR_START}${spinnerFrame}${DOWNLOAD_PROGRESS_SPINNER_COLOR_END}`
      const progressPrefix =
        typeof totalBytes === 'number' && totalBytes > 0
          ? `${((downloadedBytes / totalBytes) * 100).toFixed(1)}% (${this.formatBytes(downloadedBytes)}/${this.formatBytes(totalBytes)})`
          : this.formatBytes(downloadedBytes)
      const eta =
        progress.etaMs !== null
          ? ` | ${this.formatDuration(progress.etaMs)} left`
          : ''
      const line = `${coloredSpinnerFrame} ${progressPrefix} ${this.formatBytes(
        progress.bytesPerSecond
      )}/s${eta}`

      if (isTTY) {
        readline.clearLine(process.stdout, 0)
        readline.cursorTo(process.stdout, 0)
        process.stdout.write(line)
      } else {
        console.log(line)
      }
    }

    return {
      update: (downloadedBytes: number): void => {
        render(downloadedBytes)
      },
      finish: (downloadedBytes: number): void => {
        render(downloadedBytes, true)

        if (options.cliProgress && isTTY) {
          process.stdout.write('\n')
        }

        if (options.cliProgress) {
          console.log(
            `${fileName} downloaded ${this.formatBytes(downloadedBytes)} in ${this.formatDuration(
              Date.now() - startedAt
            )}`
          )
        }

        if (didEmitSetupDownloadProgressStart) {
          process.emit(SETUP_DOWNLOAD_PROGRESS_END_EVENT)
          didEmitSetupDownloadProgressStart = false
        }
      },
      fail: (): void => {
        if (options.cliProgress && isTTY) {
          readline.clearLine(process.stdout, 0)
          readline.cursorTo(process.stdout, 0)
        }

        if (
          shouldEmitSetupDownloadProgressEvents &&
          didEmitSetupDownloadProgressStart
        ) {
          process.emit(SETUP_DOWNLOAD_PROGRESS_END_EVENT)
          didEmitSetupDownloadProgressStart = false
        }
      }
    }
  }

  private static getRetryDelay(
    attemptIndex: number,
    retryOptions: RetryOptions
  ): number {
    const baseDelay =
      retryOptions.minTimeout *
      retryOptions.factor ** Math.max(0, attemptIndex - 1)

    return Math.min(retryOptions.maxTimeout, Math.round(baseDelay))
  }

  private static getParallelPartCount(
    totalBytes: number,
    parallelStreams: number
  ): number {
    const sizeLimitedPartCount = Math.max(
      1,
      Math.floor(totalBytes / PARALLEL_DOWNLOAD_MIN_RANGE_BYTES)
    )

    return Math.max(1, Math.min(parallelStreams, sizeLimitedPartCount))
  }

  private static splitByteRanges(
    totalBytes: number,
    partCount: number
  ): Array<{ start: number, end: number }> {
    const ranges: Array<{ start: number, end: number }> = []
    const basePartSize = Math.floor(totalBytes / partCount)
    let start = 0

    for (let index = 0; index < partCount; index += 1) {
      const isLastPart = index === partCount - 1
      const end = isLastPart ? totalBytes - 1 : start + basePartSize - 1

      ranges.push({
        start,
        end
      })

      start = end + 1
    }

    return ranges
  }

  private static async probeRemoteFile(
    fileURL: string,
    retryOptions: DownloadInfoRetryOptions,
    signal?: AbortSignal
  ): Promise<DownloadProbe> {
    for (
      let attempt = 0;
      attempt <= retryOptions.retries;
      attempt += 1
    ) {
      this.throwIfAborted(signal)
      let fallbackProbe: DownloadProbe | null = null

      try {
        const headResponse = await fetch(fileURL, {
          method: 'HEAD',
          ...(signal ? { signal } : {})
        })

        if (headResponse.ok) {
          const acceptRanges =
            headResponse.headers.get('accept-ranges')?.toLowerCase() === 'bytes'
          const totalBytes = this.parseContentLength(
            headResponse.headers.get('content-length')
          )

          if (acceptRanges) {
            return {
              totalBytes,
              acceptRanges
            }
          }

          fallbackProbe = {
            totalBytes,
            acceptRanges: false
          }
        }
      } catch {
        this.throwIfAborted(signal)
        // Fall back to a ranged probe when HEAD is unsupported or incomplete.
      }

      try {
        const rangeResponse = await fetch(fileURL, {
          headers: {
            range: 'bytes=0-0'
          },
          ...(signal ? { signal } : {})
        })

        if (!rangeResponse.ok) {
          throw new Error(
            `Failed to fetch download info for "${fileURL}" (HTTP ${rangeResponse.status} ${rangeResponse.statusText})`
          )
        }

        const acceptRanges =
          rangeResponse.status === 206 ||
          rangeResponse.headers.get('accept-ranges')?.toLowerCase() === 'bytes' ||
          !!rangeResponse.headers.get('content-range')
        const totalBytes =
          this.parseContentRangeTotalBytes(
            rangeResponse.headers.get('content-range')
          ) ||
          this.parseContentLength(rangeResponse.headers.get('content-length'))

        await rangeResponse.body?.cancel().catch(() => {})

        return {
          totalBytes,
          acceptRanges
        }
      } catch (error) {
        if (this.isAbortError(error)) {
          throw error
        }

        if (fallbackProbe) {
          return fallbackProbe
        }

        if (attempt === retryOptions.retries) {
          throw error
        }
      }

      this.throwIfAborted(signal)
      await this.sleep(this.getRetryDelay(attempt + 1, retryOptions))
    }

    return {
      totalBytes: null,
      acceptRanges: false
    }
  }

  private static async downloadSequential(
    fileURL: string,
    temporaryPath: string,
    probe: DownloadProbe,
    reporter: ProgressReporter,
    inactivityTimeoutMs: number,
    signal?: AbortSignal
  ): Promise<number> {
    let startOffset = 0

    if (probe.acceptRanges && probe.totalBytes !== null && fs.existsSync(temporaryPath)) {
      const temporaryStat = await fs.promises.stat(temporaryPath)

      if (temporaryStat.isFile()) {
        if (temporaryStat.size > 0 && temporaryStat.size < probe.totalBytes) {
          startOffset = temporaryStat.size
        } else if (temporaryStat.size >= probe.totalBytes) {
          await fs.promises.rm(temporaryPath, { force: true })
        }
      }
    }

    reporter.update(startOffset)

    while (true) {
      this.throwIfAborted(signal)
      const headers =
        startOffset > 0
          ? {
              range: `bytes=${startOffset}-`
            }
          : undefined
      const inactivityController = this.createInactivityController(
        signal,
        inactivityTimeoutMs
      )
      let response: Response

      try {
        response = await fetch(fileURL, {
          ...(headers ? { headers } : {}),
          signal: inactivityController.signal
        })
      } catch (error) {
        inactivityController.dispose()
        throw error
      }

      if (!response.ok) {
        inactivityController.dispose()
        throw new Error(
          `Failed to download "${fileURL}" (HTTP ${response.status} ${response.statusText})`
        )
      }

      if (!response.body) {
        inactivityController.dispose()
        throw new Error(`Failed to download "${fileURL}": empty response body`)
      }

      if (startOffset > 0 && response.status !== 206) {
        await Promise.all([
          fs.promises.rm(temporaryPath, { force: true })
        ])
        startOffset = 0
        reporter.update(0)
        await response.body.cancel().catch(() => {})
        inactivityController.dispose()
        continue
      }

      const fileHandle = await fs.promises.open(
        temporaryPath,
        startOffset > 0 ? 'r+' : 'w'
      )
      const reader = response.body.getReader()
      let downloadedBytes = startOffset
      let writePosition = startOffset

      try {
        while (true) {
          this.throwIfAborted(signal)
          const { done, value } = await reader.read()

          if (done) {
            break
          }

          if (!value || value.byteLength === 0) {
            continue
          }

          const chunk = Buffer.from(value)
          await fileHandle.write(chunk, 0, chunk.length, writePosition)
          inactivityController.refresh()
          writePosition += chunk.length
          downloadedBytes += chunk.length
          reporter.update(downloadedBytes)
        }

        const expectedBytes =
          probe.totalBytes ??
          (startOffset +
            (this.parseContentLength(response.headers.get('content-length')) || 0))

        if (expectedBytes > 0 && downloadedBytes !== expectedBytes) {
          throw new Error(
            `Downloaded size mismatch for "${fileURL}". Expected ${expectedBytes} bytes but received ${downloadedBytes}.`
          )
        }

        await fileHandle.sync()

        return downloadedBytes
      } finally {
        await reader.cancel().catch(() => {})
        await fileHandle.close()
        inactivityController.dispose()
      }
    }
  }

  private static getParallelDownloadStatePath(temporaryPath: string): string {
    return `${temporaryPath}.state.json`
  }

  private static readParallelDownloadState(
    statePath: string,
    fileURL: string,
    totalBytes: number
  ): ParallelDownloadState | null {
    if (!fs.existsSync(statePath)) {
      return null
    }

    try {
      const state = JSON.parse(
        fs.readFileSync(statePath, 'utf8')
      ) as ParallelDownloadState
      const hasValidRanges =
        Array.isArray(state.ranges) &&
        state.ranges.every(
          (range) =>
            Number.isInteger(range.start) &&
            Number.isInteger(range.end) &&
            Number.isInteger(range.position) &&
            range.start >= 0 &&
            range.end >= range.start &&
            range.end < totalBytes &&
            range.position >= range.start &&
            range.position <= range.end + 1
        )

      if (
        state.version !== PARALLEL_DOWNLOAD_STATE_VERSION ||
        state.fileURL !== fileURL ||
        state.totalBytes !== totalBytes ||
        !hasValidRanges
      ) {
        return null
      }

      return state
    } catch {
      return null
    }
  }

  private static persistParallelDownloadState(
    statePath: string,
    state: ParallelDownloadState
  ): void {
    const nextStatePath = `${statePath}.next`

    fs.writeFileSync(nextStatePath, JSON.stringify(state), 'utf8')
    fs.renameSync(nextStatePath, statePath)
  }

  private static createParallelDownloadState(
    fileURL: string,
    totalBytes: number,
    initialDownloadedBytes: number,
    parallelStreams: number
  ): ParallelDownloadState {
    const remainingBytes = totalBytes - initialDownloadedBytes
    const partCount = this.getParallelPartCount(
      remainingBytes,
      parallelStreams
    )
    const ranges = this.splitByteRanges(remainingBytes, partCount).map(
      (range): ParallelDownloadRange => ({
        start: range.start + initialDownloadedBytes,
        end: range.end + initialDownloadedBytes,
        position: range.start + initialDownloadedBytes
      })
    )

    return {
      version: PARALLEL_DOWNLOAD_STATE_VERSION,
      fileURL,
      totalBytes,
      ranges
    }
  }

  private static async downloadParallel(
    fileURL: string,
    temporaryPath: string,
    totalBytes: number,
    parallelStreams: number,
    reporter: ProgressReporter,
    retryOptions: RetryOptions,
    inactivityTimeoutMs: number,
    signal?: AbortSignal
  ): Promise<number> {
    const statePath = this.getParallelDownloadStatePath(temporaryPath)
    const hadStateFile = fs.existsSync(statePath)
    let state = this.readParallelDownloadState(
      statePath,
      fileURL,
      totalBytes
    )
    let initialDownloadedBytes = 0

    if (state && !fs.existsSync(temporaryPath)) {
      state = null
    }

    if (!state && hadStateFile) {
      await Promise.all([
        fs.promises.rm(statePath, { force: true }),
        fs.promises.rm(temporaryPath, { force: true })
      ])
    }

    if (!state && fs.existsSync(temporaryPath)) {
      const temporaryStat = await fs.promises.stat(temporaryPath)

      if (temporaryStat.isFile() && temporaryStat.size < totalBytes) {
        initialDownloadedBytes = temporaryStat.size
      } else {
        await fs.promises.rm(temporaryPath, { force: true })
      }
    }

    if (!state) {
      state = this.createParallelDownloadState(
        fileURL,
        totalBytes,
        initialDownloadedBytes,
        parallelStreams
      )
      this.persistParallelDownloadState(statePath, state)
    }

    const ranges = state.ranges
    const downloadedRangeBytes = ranges.reduce(
      (total, range) => total + (range.position - range.start),
      0
    )
    const totalRangeBytes = ranges.reduce(
      (total, range) => total + (range.end - range.start + 1),
      0
    )
    initialDownloadedBytes = totalBytes - totalRangeBytes
    const fileHandle = await fs.promises.open(
      temporaryPath,
      fs.existsSync(temporaryPath) ? 'r+' : 'w'
    )
    let downloadedBytes = initialDownloadedBytes + downloadedRangeBytes
    const rangeAbortController = new AbortController()
    const abortRanges = (): void => {
      rangeAbortController.abort(signal?.reason)
    }

    if (signal?.aborted) {
      abortRanges()
    } else {
      signal?.addEventListener('abort', abortRanges, { once: true })
    }

    reporter.update(downloadedBytes)

    const rangeTasks = ranges
      .filter((range) => range.position <= range.end)
      .map(async (range) => {
        let writePosition = range.position
        let nextCheckpointAt =
          writePosition + PARALLEL_DOWNLOAD_CHECKPOINT_BYTES
        let consecutiveNoProgressFailures = 0

        while (writePosition <= range.end) {
          const requestStartPosition = writePosition
          const inactivityController = this.createInactivityController(
            rangeAbortController.signal,
            inactivityTimeoutMs
          )

          try {
            this.throwIfAborted(rangeAbortController.signal)
            const response = await fetch(fileURL, {
              headers: {
                range: `bytes=${writePosition}-${range.end}`
              },
              signal: inactivityController.signal
            })

            if (response.status !== 206) {
              throw new Error(
                `Server does not support ranged download for "${fileURL}".`
              )
            }

            if (!response.body) {
              throw new Error(
                `Failed to download "${fileURL}": empty response body`
              )
            }

            const reader = response.body.getReader()

            try {
              while (true) {
                this.throwIfAborted(rangeAbortController.signal)
                const { done, value } = await reader.read()

                if (done) {
                  break
                }

                if (!value || value.byteLength === 0) {
                  continue
                }

                const chunk = Buffer.from(value)
                await fileHandle.write(chunk, 0, chunk.length, writePosition)
                inactivityController.refresh()
                writePosition += chunk.length
                range.position = writePosition
                downloadedBytes += chunk.length
                reporter.update(downloadedBytes)

                if (writePosition >= nextCheckpointAt) {
                  this.persistParallelDownloadState(statePath, state)
                  nextCheckpointAt =
                    writePosition + PARALLEL_DOWNLOAD_CHECKPOINT_BYTES
                }
              }
            } finally {
              await reader.cancel().catch(() => {})
            }

            if (writePosition !== range.end + 1) {
              throw new Error(
                `Incomplete ranged download for "${fileURL}" on bytes ${range.start}-${range.end}.`
              )
            }

            this.persistParallelDownloadState(statePath, state)
            return
          } catch (error) {
            range.position = writePosition
            this.persistParallelDownloadState(statePath, state)

            if (
              this.isAbortError(error) ||
              rangeAbortController.signal.aborted
            ) {
              throw error
            }

            const madeProgress = writePosition > requestStartPosition
            consecutiveNoProgressFailures = madeProgress
              ? 0
              : consecutiveNoProgressFailures + 1

            if (consecutiveNoProgressFailures > retryOptions.retries) {
              throw error
            }

            LogHelper.warning(
              `Download range ${range.start}-${range.end} failed at byte ${writePosition}; retrying: ${String(error)}`
            )
            await this.sleep(
              this.getRetryDelay(
                Math.max(1, consecutiveNoProgressFailures),
                retryOptions
              )
            )
          } finally {
            inactivityController.dispose()
          }
        }

        throw new Error(
          `Failed to download range ${range.start}-${range.end}.`
        )
      })

    try {
      await Promise.all(rangeTasks)

      if (downloadedBytes !== totalBytes) {
        throw new Error(
          `Downloaded size mismatch for "${fileURL}". Expected ${totalBytes} bytes but received ${downloadedBytes}.`
        )
      }

      await fileHandle.sync()

      return downloadedBytes
    } catch (error) {
      rangeAbortController.abort(error)
      await Promise.allSettled(rangeTasks)
      this.persistParallelDownloadState(statePath, state)
      throw error
    } finally {
      signal?.removeEventListener('abort', abortRanges)
      await fileHandle.close()
    }
  }

  private static async downloadRemoteFile(
    fileURL: string,
    destinationPath: string,
    options: ResolvedDownloadFileOptions
  ): Promise<void> {
    const retryOptions = options.retry
    const temporaryPath = `${destinationPath}.download`
    const parallelStatePath = this.getParallelDownloadStatePath(temporaryPath)
    const legacyTemporaryPath = `${destinationPath}.ipull`
    const abortController = new AbortController()
    const { signal } = abortController

    this.activeDownloadControllers.add(abortController)

    try {
      for (
        let attempt = 0;
        attempt <= retryOptions.retries;
        attempt += 1
      ) {
        let reporter: ProgressReporter = {
          update: () => {},
          finish: () => {},
          fail: () => {}
        }
        try {
          this.throwIfAborted(signal)
          const probe = await this.probeRemoteFile(
            fileURL,
            options.retryFetchDownloadInfo,
            signal
          )
          const useParallelDownload =
            probe.acceptRanges &&
            probe.totalBytes !== null &&
            probe.totalBytes >= PARALLEL_DOWNLOAD_MIN_BYTES &&
            options.parallelStreams > 1

          await Promise.all([
            fs.promises.mkdir(path.dirname(destinationPath), {
              recursive: true
            }),
            fs.promises.rm(destinationPath, { force: true }),
            fs.promises.rm(legacyTemporaryPath, { force: true })
          ])

          reporter = this.createProgressReporter(
            destinationPath,
            options,
            probe.totalBytes || undefined
          )

          const downloadedBytes = useParallelDownload
            ? await this.downloadParallel(
                fileURL,
                temporaryPath,
                probe.totalBytes as number,
                options.parallelStreams,
                reporter,
                retryOptions,
                options.inactivityTimeoutMs,
                signal
              )
            : await this.downloadSequential(
                fileURL,
                temporaryPath,
                probe,
                reporter,
                options.inactivityTimeoutMs,
                signal
              )

          this.throwIfAborted(signal)
          await this.movePath(temporaryPath, destinationPath)
          await this.ensureDownloadedFilePath(destinationPath)
          await fs.promises.rm(parallelStatePath, { force: true })
          reporter.finish(downloadedBytes)

          return
        } catch (error) {
          reporter.fail()

          await fs.promises.rm(destinationPath, { force: true })

          if (this.isAbortError(error) || signal.aborted) {
            throw this.createAbortError()
          }

          if (attempt === retryOptions.retries) {
            throw error
          }

          LogHelper.warning(
            `Download attempt ${attempt + 1} failed; retrying: ${String(error)}`
          )

          await this.sleep(this.getRetryDelay(attempt + 1, retryOptions))
        }
      }
    } finally {
      this.activeDownloadControllers.delete(abortController)
    }
  }

  private static async copyLocalFile(
    filePath: string,
    destinationPath: string
  ): Promise<void> {
    await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true })
    await fs.promises.copyFile(filePath, destinationPath)
    await this.ensureDownloadedFilePath(destinationPath)
  }

  /**
   * Check if the current network can access Hugging Face
   * @example canAccessHuggingFace() // true
   */
  public static async canAccessHuggingFace(): Promise<boolean> {
    try {
      await axios.head(HUGGING_FACE_URL)

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
  public static async setHuggingFaceURL(url: string): Promise<string> {
    if (!url.includes('huggingface.co')) {
      return url
    }

    const canAccess = await NetworkHelper.canAccessHuggingFace()

    if (!canAccess) {
      return url.replace(HUGGING_FACE_URL, HUGGING_FACE_MIRROR_URL)
    }

    return url
  }

  /**
   * Download a file from either a remote URL or a local source path.
   */
  public static async downloadFile(
    fileURL: string,
    destinationPath: string,
    options?: DownloadFileOptions
  ): Promise<void> {
    const resolvedOptions: ResolvedDownloadFileOptions = {
      ...this.DEFAULT_DOWNLOAD_OPTIONS,
      ...options,
      retry: {
        ...this.DEFAULT_DOWNLOAD_OPTIONS.retry,
        ...options?.retry
      },
      retryFetchDownloadInfo: {
        ...this.DEFAULT_DOWNLOAD_OPTIONS.retryFetchDownloadInfo,
        ...options?.retryFetchDownloadInfo
      }
    }

    if (
      resolvedOptions.skipExisting &&
      fs.existsSync(destinationPath) &&
      (await fs.promises.stat(destinationPath)).isFile()
    ) {
      return
    }

    if (this.isRemoteURL(fileURL)) {
      await this.downloadRemoteFile(fileURL, destinationPath, resolvedOptions)

      return
    }

    await this.copyLocalFile(fileURL, destinationPath)
  }

  /**
   * Abort every currently active remote download.
   * @param reason The reason attached to the abort signal
   * @returns The number of downloads that were asked to stop
   */
  public static abortActiveDownloads(
    reason = 'Download interrupted'
  ): number {
    let abortedCount = 0

    for (const abortController of this.activeDownloadControllers) {
      if (abortController.signal.aborted) {
        continue
      }

      abortController.abort(this.createAbortError(reason))
      abortedCount += 1
    }

    return abortedCount
  }
}
