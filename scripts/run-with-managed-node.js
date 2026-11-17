import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { getUpdateStatePath } from './update/paths.js'
import { LEON_UPDATE_EXIT_CODE, UpdatePhase } from '../bridges/runtime/contracts/update-status.js'

const DEFAULT_LEON_HOME_DIRNAME = '.leon'
// Must match server/src/core/server-lifecycle.ts.
const LEON_RESTART_EXIT_CODE = 77

/**
 * This launcher must stay plain-Node compatible because it is invoked before
 * tsx/path aliases are available.
 */
function resolveLeonHomePath() {
  const configuredLeonHome = String(process.env['LEON_HOME'] || '').trim()

  return configuredLeonHome
    ? path.resolve(configuredLeonHome)
    : path.join(os.homedir(), DEFAULT_LEON_HOME_DIRNAME)
}

const leonHomePath = resolveLeonHomePath()
const managedNodePath = process.platform === 'win32'
  ? path.join(leonHomePath, 'bin', 'node', 'node.exe')
  : path.join(leonHomePath, 'bin', 'node', 'bin', 'node')
const args = process.argv.slice(2)

if (!fs.existsSync(managedNodePath)) {
  console.error(
    `Managed Node.js binary not found at "${managedNodePath}". Run "pnpm run postinstall" first.`
  )
  process.exit(1)
}

if (args.length === 0) {
  console.error('No script was provided to the managed Node.js launcher.')
  process.exit(1)
}

let child = null
let shouldRestart = true

function startManagedProcess(afterUpdate = false) {
  const codebase = path.resolve(process.env.LEON_CODEBASE_PATH || process.cwd())
  const statePath = getUpdateStatePath(leonHomePath, codebase)
  if (!afterUpdate && fs.existsSync(statePath)) {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    if ([UpdatePhase.Scheduled, UpdatePhase.Installing].includes(state.phase)) {
      fs.writeFileSync(statePath, JSON.stringify({ ...state, phase: UpdatePhase.Failed,
        error: 'I was interrupted while updating. Check for updates again to retry.' }), { mode: 0o600 })
    }
  }
  const version = JSON.parse(fs.readFileSync(path.join(codebase, 'package.json'), 'utf8')).version
  child = spawn(managedNodePath, args, {
    cwd: process.cwd(),
    env: { ...process.env, LEON_MANAGED_LAUNCHER: 'true', npm_package_version: version },
    stdio: 'inherit',
    windowsHide: true
  })

  child.on('error', (error) => {
    console.error(error)
    process.exit(1)
  })

  child.on('exit', (code, signal) => {
    child = null

    if (signal) {
      process.kill(process.pid, signal)
      return
    }

    if (shouldRestart && code === LEON_RESTART_EXIT_CODE) {
      startManagedProcess()
      return
    }

    if (shouldRestart && code === LEON_UPDATE_EXIT_CODE) {
      runPendingUpdate(codebase)
      return
    }

    process.exit(code ?? 0)
  })
}

/**
 * Keeps dependency replacement outside Core's lifetime, then restores service
 * after either a completed installation or a reported installation failure.
 */
function runPendingUpdate(codebase) {
  const statePath = getUpdateStatePath(leonHomePath, codebase)
  const job = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  let settled = false
  const finish = (error) => {
    if (settled) {
      return
    }
    settled = true
    child = null
    if (error) {
      let state = job
      try {
        state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      } catch {
        // A killed installer may leave an incomplete status write.
      }
      if (state.phase !== UpdatePhase.Failed) {
        fs.writeFileSync(statePath, JSON.stringify({ ...job, phase: UpdatePhase.Failed, error: String(error) }), { mode: 0o600 })
      }
    }
    if (shouldRestart) {
      startManagedProcess(true)
    }
  }
  child = spawn(managedNodePath, [path.join(codebase, 'scripts', 'update', 'run-update.js'), statePath], {
    cwd: codebase, stdio: 'inherit', windowsHide: true
  })
  child.once('error', finish)
  child.once('exit', (code) => finish(code === 0 ? null : new Error('I couldn’t finish installing the update.')))
}

function stopManagedProcess(signal) {
  shouldRestart = false

  if (child?.pid) {
    child.kill(signal)
    return
  }

  process.exit(0)
}

process.on('SIGINT', () => {
  stopManagedProcess('SIGINT')
})

process.on('SIGTERM', () => {
  stopManagedProcess('SIGTERM')
})

startManagedProcess()
