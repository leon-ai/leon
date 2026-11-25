import fs from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { execa } from 'execa'
import psList from 'ps-list'

import { controlCore } from '../apps/desktop/src/service.ts'
import { LEON_HOME_PATH } from '../server/src/leon-roots.ts'
import {
  serverShutdownControlDirectory, serverShutdownControlPath, verifyServerShutdownControlDirectory
} from '../server/src/core/server-shutdown-control.ts'

const SERVER_ENTRY = 'server/dist/index.js'
const MANAGED_LAUNCHER = 'scripts/run-with-managed-node.js'
const SHUTDOWN_RECORD_PATTERN = /^(\d+)-[a-f0-9]{8}\.json$/
const STOP_TIMEOUT_MS = 30_000
const STOP_POLL_MS = 100

/**
 * Waits for a confirmed server or launcher to exit before replacing its files.
 */
async function waitForServerExit(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error('I could not verify the server process ID.')
  }

  const deadline = Date.now() + STOP_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      if (error.code === 'ESRCH') {
        return
      }
      throw error
    }

    await delay(STOP_POLL_MS)
  }

  throw new Error(`I could not stop the server process ${pid}. Stop it and run the build again.`)
}

async function readJSON(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

async function stopRegisteredServer(codebase) {
  const directory = serverShutdownControlDirectory(codebase)
  const records = await verifyServerShutdownControlDirectory(directory).then(() =>
    fs.readdir(directory, { withFileTypes: true })
  ).catch((error) => {
    if (error.code === 'ENOENT') {
      return []
    }
    throw error
  })

  await Promise.all(records.filter((entry) => entry.isFile()).map(async ({ name }) => {
    const match = SHUTDOWN_RECORD_PATTERN.exec(name)
    if (!match) {
      return
    }

    const config = await readJSON(path.join(directory, name))
    if (typeof config?.controlToken !== 'string' || config.controlToken.length !== 64) {
      return
    }

    const controlPath = serverShutdownControlPath(directory, path.parse(name).name)
    const server = await controlCore({ controlPath, controlToken: config.controlToken }, 'stop')
    const pid = Number(match[1])
    if (server && server.pid !== pid) {
      throw new Error('I could not verify the server shutdown response.')
    }

    // A server still running must block the build even if it could not answer the stop request.
    await waitForServerExit(pid)
    await fs.rm(path.join(directory, name), { force: true })
  }))
}

async function stopDesktopServer(codebase) {
  const serviceDirectory = path.join(LEON_HOME_PATH, 'desktop', 'service')
  const config = await readJSON(path.join(serviceDirectory, 'core.json'))
  if (!config || config.runtimeHome || !config.codebase) {
    return
  }

  const desktopCodebase = await fs.realpath(config.codebase).catch((error) => {
    if (error.code === 'ENOENT') {
      return null
    }
    throw error
  })
  if (desktopCodebase !== codebase) {
    return
  }

  const runner = await controlCore(config)
  if (runner) {
    await controlCore(config, 'stop')
    await waitForServerExit(runner.pid)
    return
  }

  // The authenticated channel can be unavailable while a launcher starts or stops.
  const pid = Number(await fs.readFile(path.join(serviceDirectory, 'runner.lock', 'pid'), 'utf8').catch((error) => {
    if (error.code === 'ENOENT') {
      return ''
    }
    throw error
  }))
  if (pid > 0) {
    await waitForServerExit(pid)
  }
}

async function readProcessDirectory(pid) {
  try {
    if (process.platform === 'linux') {
      return await fs.realpath(`/proc/${pid}/cwd`)
    }

    const { stdout } = await execa('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { timeout: 2_000 })
    const directory = stdout.split('\n').find((line) => line.startsWith('n'))?.slice(1)

    return directory ? await fs.realpath(directory) : null
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH' || error.exitCode === 1) {
      return null
    }
    throw error
  }
}

// Older terminal launchers have no control records. On Unix, the server child,
// the exact launcher invocation and the working directory together prove ownership.
async function stopLegacyTerminalServers(codebase) {
  if (process.platform === 'win32') {
    return
  }

  const processes = await psList({ all: false }).catch((error) => {
    if (error.code === 'ENOENT') {
      return []
    }
    throw error
  })
  const launchers = new Map(processes.map((entry) => [entry.pid, entry.cmd]))
  const relative = ` ${MANAGED_LAUNCHER} ${SERVER_ENTRY}`
  const absolute = ` ${path.join(codebase, MANAGED_LAUNCHER)} ${SERVER_ENTRY}`

  await Promise.all(processes.map(async ({ pid, ppid, cmd }) => {
    const launcher = launchers.get(ppid)
    if (!cmd?.startsWith('leon-') || (!launcher?.endsWith(relative) && !launcher?.endsWith(absolute))) {
      return
    }
    if (await readProcessDirectory(pid) !== codebase) {
      return
    }

    try {
      process.kill(pid, 'SIGTERM')
    } catch (error) {
      if (error.code === 'ESRCH') {
        return
      }
      throw error
    }

    await waitForServerExit(pid)
  }))
}

/**
 * Stops server instances serving this checkout before build output is replaced.
 */
export async function stopCheckoutServer(directory) {
  const codebase = await fs.realpath(directory)

  await stopRegisteredServer(codebase)
  await stopDesktopServer(codebase)
  await stopLegacyTerminalServers(codebase)
}
