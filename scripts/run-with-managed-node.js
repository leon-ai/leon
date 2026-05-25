import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import fs from 'node:fs'

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

function startManagedProcess() {
  child = spawn(managedNodePath, args, {
    cwd: process.cwd(),
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

    process.exit(code ?? 0)
  })
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
