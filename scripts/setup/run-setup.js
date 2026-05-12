import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const SETUP_ENTRY_PATH = path.join('scripts', 'setup', 'setup.js')
const TSX_ENTRY_PATH = path.join(
  process.cwd(),
  'node_modules',
  'tsx',
  'dist',
  'cli.mjs'
)
const TTY_PATH = '/dev/tty'
const WINDOWS_CONSOLE_IN_PATH = 'CONIN$'
const WINDOWS_CONSOLE_OUT_PATH = 'CONOUT$'

// pnpm 11 reads project config from pnpm-workspace.yaml. That also makes root
// lifecycle scripts run through pnpm's workspace runner, which does not expose
// a TTY to the child process. Leon setup needs a TTY to ask setup questions, so
// this wrapper reattaches the real setup process to the user's terminal.
function openWindowsConsoleStdio() {
  try {
    const stdin = fs.openSync(WINDOWS_CONSOLE_IN_PATH, 'r')
    const stdout = fs.openSync(WINDOWS_CONSOLE_OUT_PATH, 'w')

    return [stdin, stdout, stdout]
  } catch {
    return null
  }
}

// Use the controlling terminal when available. In CI, Docker, or other
// non-interactive contexts there may be no terminal, so setup falls back to the
// inherited stdio and keeps its existing non-interactive behavior.
function getTTYStdio() {
  if (process.platform === 'win32') {
    return openWindowsConsoleStdio()
  }

  if (!fs.existsSync(TTY_PATH)) {
    return null
  }

  try {
    const tty = fs.openSync(TTY_PATH, 'r+')

    return [tty, tty, tty]
  } catch {
    return null
  }
}

function closeTTYStdio(stdio) {
  if (stdio === null) {
    return
  }

  for (const descriptor of new Set(stdio)) {
    fs.closeSync(descriptor)
  }
}

async function runSetup() {
  const ttyStdio = getTTYStdio()

  try {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [TSX_ENTRY_PATH, SETUP_ENTRY_PATH], {
        cwd: process.cwd(),
        env: process.env,
        stdio: ttyStdio || 'inherit',
        windowsHide: false
      })

      child.once('error', reject)
      child.once('exit', (code, signal) => {
        if (signal) {
          process.kill(process.pid, signal)
          return
        }

        if ((code ?? 0) !== 0) {
          reject(new Error(`Setup exited with code ${code ?? 0}`))
          return
        }

        resolve()
      })
    })
  } finally {
    closeTTYStdio(ttyStdio)
  }
}

runSetup().catch((error) => {
  console.error(error)
  process.exit(1)
})
