import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import kill from 'tree-kill'

import { recordUpdateProgress, finishUpdateProgress } from './progress.js'
import { UpdatePhase } from '../../bridges/runtime/contracts/update-status.js'

const execute = promisify(execFile)
const GIT_TIMEOUT_MS = 60_000
const SETUP_TIMEOUT_MS = 30 * 60_000

/**
 * Runs the installer with closed stdin so existing setup preferences are reused
 * instead of opening an interactive prompt in a background server update.
 */
async function install(job) {
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') || 'PATH'
  const env = {
    ...process.env,
    [pathKey]: [path.dirname(process.execPath), process.env[pathKey] || ''].join(path.delimiter),
    LEON_CODEBASE_PATH: job.root,
    LEON_PROFILE: job.profile,
    LEON_OPEN_BROWSER: 'false',
    LEON_SETUP_UPDATE: 'true',
    npm_package_version: JSON.parse(await fs.readFile(path.join(job.root, 'package.json'), 'utf8')).version
  }
  const run = (command, args) => new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: job.root, env, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true
    })
    let timeoutError
    const timer = setTimeout(() => {
      timeoutError = new Error('The update setup timed out.')
      if (child.pid) {
        kill(child.pid, 'SIGKILL', (error) => {
          if (error) {
            console.error(`I could not stop the timed-out setup: ${error.message}`)
          }
        })
      }
    }, SETUP_TIMEOUT_MS)
    timer.unref()
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (timeoutError) {
        reject(timeoutError)
      } else if (code === 0) {
        resolve(undefined)
      } else {
        reject(new Error(`Setup exited with code ${code ?? 'unknown'}.`))
      }
    })
  })

  await run(process.execPath, [path.join(job.root, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    path.join(job.root, 'scripts', 'update', 'setup-runtimes.js')])
  // Normal lifecycle scripts build native dependencies and invoke Leon setup.
  await run(job.pnpm, ['install', '--frozen-lockfile'])
}

/**
 * Applies only the reviewed fast-forward revision while Core is stopped. A
 * failed setup restores the previous revision and rebuilds it before restart.
 */
export async function runUpdate(statePath, installer = install) {
  const job = JSON.parse(await fs.readFile(statePath, 'utf8'))
  const git = async (...args) => (await execute('git', args, {
    cwd: job.root, timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: 1_048_576
  })).stdout.trim()
  let changed = false
  const lockPath = `${statePath}.lock`
  const temporaryPath = `${statePath}.tmp`
  let lock

  // Publish whole receipts so an interrupted write cannot block Core's next boot.
  const save = async () => {
    await fs.writeFile(temporaryPath, JSON.stringify(job), { mode: 0o600 })
    await fs.rename(temporaryPath, statePath)
  }

  try {
    const previousOwner = await fs.readFile(lockPath, 'utf8').catch((error) => {
      if (error.code !== 'ENOENT') {
        throw error
      }

      return null
    })
    if (previousOwner) {
      const pid = Number(previousOwner)
      if (!Number.isSafeInteger(pid) || pid <= 0) {
        throw new Error('I could not validate the existing update lock.')
      }
      try {
        process.kill(pid, 0)
      } catch (error) {
        if (error.code === 'ESRCH') {
          await fs.rm(lockPath)
        } else {
          throw error
        }
      }
    }
    lock = await fs.open(lockPath, 'wx', 0o600)
    await lock.writeFile(String(process.pid))
    if (job.phase !== UpdatePhase.Scheduled || await git('rev-parse', 'HEAD') !== job.expectedHead
      || await git('status', '--porcelain')) {
      throw new Error('I need an unchanged, clean checkout before applying this update. Check again and retry.')
    }
    await git('merge-base', '--is-ancestor', job.expectedHead, job.revision)
    job.phase = UpdatePhase.Installing
    recordUpdateProgress(job, 'preparing', { detail: 'Installing dependencies and preparing my profiles.' })
    await save()
    await git('merge', '--ff-only', job.revision)
    changed = true
    await installer(job)
    job.phase = UpdatePhase.Restarting
    recordUpdateProgress(job, 'restarting')
    job.error = null
    await save()
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error)
    if (changed) {
      try {
        // --keep refuses to overwrite edits made externally during installation.
        await git('reset', '--keep', job.expectedHead)
        await installer(job)
      } catch (recoveryError) {
        message += ` Recovery also needs attention: ${String(recoveryError)}`
      }
    }
    if (lock) {
      job.phase = UpdatePhase.Failed
      finishUpdateProgress(job)
      job.error = message
      await save()
    }
    throw new Error(message)
  } finally {
    if (lock) {
      await fs.rm(temporaryPath, { force: true })
      await lock.close()
      await fs.rm(lockPath, { force: true })
    }
  }
}

// Launchers may reach the same file through a symlinked installation directory.
if (process.argv[1] && await fs.realpath(fileURLToPath(import.meta.url)) === await fs.realpath(process.argv[1])) {
  runUpdate(process.argv[2]).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
