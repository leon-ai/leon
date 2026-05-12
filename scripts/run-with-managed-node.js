import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import fs from 'node:fs'

const DEFAULT_LEON_HOME_DIRNAME = '.leon'

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

const child = spawn(managedNodePath, args, {
  cwd: process.cwd(),
  stdio: 'inherit',
  windowsHide: true
})

child.on('error', (error) => {
  console.error(error)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})
