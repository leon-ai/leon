import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

import { FileDownloader } from '../../server/dist/bridges/runtime/nodejs/file-downloader.js'
import { currentRuntime, installRuntimeArchive, activateRuntime, runtimeEnvironment, writeRuntimeJSON, acquireRuntimeLock } from '../distribution/runtime.js'
import { recordUpdateProgress, finishUpdateProgress } from './progress.js'
import { UpdatePhase } from '../../bridges/runtime/contracts/update-status.js'

const PREPARATION_TIMEOUT_MS = 120_000
const PROGRESS_INTERVAL_MS = 250

/**
 * Prepares profile state using the release's compiled setup, with no source
 * dependency installation and no build tools on the owner's machine.
 */
export async function prepareRuntime(runtime, installation, environment = process.env, onDetail) {
  await new Promise((resolve, reject) => {
    const child = spawn(runtime.node, [runtime.setup], { cwd: runtime.root,
      env: { ...runtimeEnvironment(runtime, installation, environment), LEON_SETUP_PROGRESS: 'json' },
      stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true })
    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => {
      try {
        const event = JSON.parse(line)
        if (event.kind === 'leon:setup' && event.label) {
          onDetail?.(String(event.label))
        }
      } catch {
        // Ordinary subprocess output belongs in host logs, not public receipts.
      }
      console.log(line)
    })
    const timer = setTimeout(() => child.kill('SIGKILL'), PREPARATION_TIMEOUT_MS)
    child.once('error', reject)
    child.once('close', (code) => {
      clearTimeout(timer)
      lines.close()
      if (code === 0) {
        resolve()
      } else {
        reject(new Error('I could not prepare the new runtime. Open my server logs for details.'))
      }
    })
  })
}

/**
 * Applies an exact reviewed asset while the server is stopped. A failed extraction or
 * migration never selects the candidate; executable files stay version-local.
 */
export async function runRuntimeUpdate(statePath) {
  const job = JSON.parse(await fs.readFile(statePath, 'utf8'))
  const release = await acquireRuntimeLock(`${statePath}.lock`)
  let activated = false
  try {
    if (job.kind !== 'runtime' || job.phase !== UpdatePhase.Scheduled ||
      (await currentRuntime(job.installation)).manifest.version !== job.expectedVersion) {
      throw new Error('My installed runtime changed. Check for updates again.')
    }
    job.phase = UpdatePhase.Installing
    await writeRuntimeJSON(statePath, job)
    let lastProgressAt = 0
    let writing = Promise.resolve()
    let writeError
    const runtime = await installRuntimeArchive({ installation: job.installation, asset: job.asset,
      download: FileDownloader.downloadFile.bind(FileDownloader),
      onProgress(progress) {
        if (Date.now() - lastProgressAt < PROGRESS_INTERVAL_MS && progress.downloadedBytes !== progress.totalBytes) {
          return
        }
        lastProgressAt = Date.now()
        job.progress = { phase: 'downloading', downloadedBytes: progress.downloadedBytes, totalBytes: progress.totalBytes }
        const snapshot = { ...job }
        writing = writing.then(() => writeRuntimeJSON(statePath, snapshot)).catch((error) => {
          writeError = error
        })
      } })
    await writing
    if (writeError) {
      throw writeError
    }
    recordUpdateProgress(job, 'preparing')
    await writeRuntimeJSON(statePath, job)
    await prepareRuntime(runtime, job.installation, { ...process.env, LEON_PROFILE: job.profile }, (detail) => {
      recordUpdateProgress(job, 'preparing', { detail })
      const snapshot = structuredClone(job)
      writing = writing.then(() => writeRuntimeJSON(statePath, snapshot)).catch((error) => {
        writeError = error
      })
    })
    await writing
    if (writeError) {
      throw writeError
    }
    await activateRuntime(job.installation, job.version)
    activated = true
    job.phase = UpdatePhase.Restarting
    recordUpdateProgress(job, 'restarting')
    await writeRuntimeJSON(statePath, job)
  } catch (error) {
    if (activated) {
      await activateRuntime(job.installation, job.expectedVersion)
    }
    job.phase = UpdatePhase.Failed
    finishUpdateProgress(job)
    job.error = error instanceof Error ? error.message : String(error)
    await writeRuntimeJSON(statePath, job)
    throw error
  } finally {
    await release()
  }
}

if (process.argv[1] && await fs.realpath(process.argv[1]) === await fs.realpath(fileURLToPath(import.meta.url))) {
  runRuntimeUpdate(process.argv[2]).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
