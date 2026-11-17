import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { currentRuntime, activateRuntime, runtimeEnvironment, writeRuntimeJSON, pruneRuntimeVersions } from './distribution/runtime.js'
import { recordUpdateProgress, finishUpdateProgress } from './update/progress.js'
import { getUpdateStatePath } from './update/paths.js'
import { CORE_READY_EVENT, LEON_RESTART_EXIT_CODE, LEON_UPDATE_EXIT_CODE, UpdatePhase } from '../bridges/runtime/contracts/update-status.js'

const READY_TIMEOUT_MS = 120_000
const STOP_TIMEOUT_MS = 10_000

/**
 * Supervises prebuilt Core versions outside their lifetime. A failed candidate
 * restores code selection without undoing profile migrations or owner data.
 */
export async function runRuntime(installation, { signal } = {}) {
  let child
  let stopping = false
  const stop = () => {
    stopping = true
    child?.kill('SIGTERM')
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  signal?.addEventListener('abort', stop, { once: true })
  const statePath = getUpdateStatePath(process.env.LEON_HOME, installation, installation)
  const readJob = () => fs.readFile(statePath, 'utf8').then(JSON.parse).catch((error) => {
    if (error.code === 'ENOENT') {
      return null
    }
    throw error
  })
  const fail = async (job, error) => {
    if (job.expectedVersion) {
      await activateRuntime(installation, job.expectedVersion)
    }
    job.phase = UpdatePhase.Failed
    job.error = String(error)
    finishUpdateProgress(job)
    await writeRuntimeJSON(statePath, job)
  }
  const execute = (runtime, script, { readiness = false, onReady, args = [] } = {}) => new Promise((resolve, reject) => {
    let ready = false
    let timeout
    let forceStop
    child = spawn(runtime.node, [script, ...args], { cwd: runtime.root,
      env: runtimeEnvironment(runtime, installation, process.env), windowsHide: true,
      stdio: readiness ? ['ignore', 'inherit', 'inherit', 'ipc'] : ['ignore', 'inherit', 'inherit'] })
    if (readiness) {
      timeout = setTimeout(() => {
        child?.kill('SIGTERM')
        forceStop = setTimeout(() => child?.kill('SIGKILL'), STOP_TIMEOUT_MS)
      }, READY_TIMEOUT_MS)
      child.on('message', (message) => {
        if (message?.kind === CORE_READY_EVENT && message.version === runtime.manifest.version) {
          ready = true
          clearTimeout(timeout)
          onReady?.()
          void pruneRuntimeVersions(installation, [process.execPath, process.env.LEON_RUNTIME_LAUNCHER_NODE]).catch(console.error)
        }
      })
    }
    child.once('error', reject)
    child.once('close', (code, exitSignal) => {
      clearTimeout(timeout)
      clearTimeout(forceStop)
      child = undefined
      if (stopping) {
        resolve({ code: 0, ready })
      } else if (exitSignal || readiness && !ready) {
        reject(new Error(`My runtime did not finish startup (${exitSignal ?? code}).`))
      } else {
        resolve({ code, ready })
      }
    })
  })
  try {
    const interrupted = await readJob()
    if (interrupted && [UpdatePhase.Scheduled, UpdatePhase.Installing].includes(interrupted.phase)) {
      await fail(interrupted, 'I was interrupted while updating. My previous runtime is still available; check again to retry.')
    }
    while (!stopping) {
      const runtime = await currentRuntime(installation)
      const job = await readJob()
      try {
        if (job?.kind === 'runtime' && job.phase === UpdatePhase.Restarting) {
          recordUpdateProgress(job, 'starting')
          await writeRuntimeJSON(statePath, job)
        }
        const precheck = await execute(runtime, path.join(runtime.root, 'server/dist/pre-check.js'))
        if (precheck.code !== 0) {
          throw new Error('My runtime pre-check failed.')
        }
        if (stopping) {
          break
        }
        const result = await execute(runtime, runtime.entry, { readiness: true, onReady() {
          if (job?.phase === UpdatePhase.Restarting && job.version === runtime.manifest.version) {
            job.phase = UpdatePhase.Completed
            finishUpdateProgress(job)
            void writeRuntimeJSON(statePath, job).catch(console.error)
          }
        } })
        if (stopping) {
          break
        }
        if (result.code === LEON_UPDATE_EXIT_CODE) {
          const pending = await readJob()
          if (!pending || pending.kind !== 'runtime' || pending.phase !== UpdatePhase.Scheduled) {
            throw new Error('No reviewed runtime update is scheduled.')
          }
          const worker = await execute(runtime, path.join(runtime.root, 'scripts/update/run-runtime-update.js'), { args: [statePath] })
          if (worker.code !== 0) {
            console.error('I could not install the runtime update. I will restart the previous version.')
          }
          continue
        }
        if (result.code === LEON_RESTART_EXIT_CODE) {
          continue
        }
        if (result.code !== 0) {
          throw new Error(`My runtime stopped with code ${result.code}.`)
        }
        break
      } catch (error) {
        if (job?.kind === 'runtime' && job.version === runtime.manifest.version &&
          job.expectedVersion !== job.version && job.phase === UpdatePhase.Restarting) {
          await fail(job, error)
          continue
        }
        throw error
      }
    }
  } finally {
    process.off('SIGTERM', stop)
    process.off('SIGINT', stop)
    signal?.removeEventListener('abort', stop)
  }
}

if (process.argv[1] && await fs.realpath(process.argv[1]) === await fs.realpath(fileURLToPath(import.meta.url))) {
  runRuntime(process.env.LEON_RUNTIME_HOME).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
