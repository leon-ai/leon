const PROGRESS_MODE = 'json'
const PROGRESS_KIND = 'leon:setup'
const DOWNLOAD_EVENT = 'leon:setup-download-progress:data'
const MINIMUM_PROGRESS_INTERVAL_MS = 100
let lastDownloadAt = 0

/**
 * Sends optional machine-readable setup state alongside ordinary child output.
 * Installers can display the same setup lifecycle without parsing terminal copy.
 */
export function reportSetupProgress(event) {
  if (process.env.LEON_SETUP_PROGRESS !== PROGRESS_MODE) {
    return
  }

  process.stdout.write(`${JSON.stringify({ kind: PROGRESS_KIND, ...event })}\n`)
}

if (process.env.LEON_SETUP_PROGRESS === PROGRESS_MODE) {
  process.on(DOWNLOAD_EVENT, (progress) => {
    const now = Date.now()

    if (
      now - lastDownloadAt < MINIMUM_PROGRESS_INTERVAL_MS &&
      progress.downloadedBytes !== progress.totalBytes
    ) {
      return
    }

    lastDownloadAt = now
    reportSetupProgress({ phase: 'download', ...progress })
  })
}
