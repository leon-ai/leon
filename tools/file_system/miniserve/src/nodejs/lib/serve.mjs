import fs from 'node:fs/promises'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const START_TIMEOUT_MS = 10_000
const PROBE_INTERVAL_MS = 50
const MAX_ERROR_CHARS = 4_000
const ENV_PREFIXES = ['MINISERVE_', 'MINISERVER_']
let server
let directory
let timer
let stopping = false

// The supervisor survives a killed worker just long enough to stop its server.
async function stop() {
  if (stopping) {
    return
  }
  stopping = true
  clearTimeout(timer)
  if (server && server.exitCode === null && server.signalCode === null) {
    const closed = new Promise((resolve) => server.once('close', resolve))
    server.kill('SIGKILL')
    await closed
  }
  if (directory) {
    await fs.rm(directory, { recursive: true, force: true })
  }
  process.exit(0)
}

process.once('disconnect', () => void stop())
process.once('SIGTERM', () => void stop())
process.once('SIGINT', () => void stop())
process.once('message', async (input) => {
  directory = input.directory
  try {
    const listener = net.createServer()
    await new Promise((resolve, reject) => {
      listener.once('error', reject)
      listener.listen(0, '0.0.0.0', resolve)
    })
    const port = listener.address().port
    await new Promise((resolve) => listener.close(resolve))
    if (stopping) {
      return
    }
    // Disable inherited miniserve environment switches, including upload modes.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !ENV_PREFIXES.some((prefix) => key.startsWith(prefix))
    ))
    server = spawn(input.binary, ['--port', String(port), '--interfaces', '0.0.0.0',
      '--route-prefix', input.route, '--no-symlinks', '--hidden', '--workers', '1',
      '--header', 'Cache-Control:no-store', '--header', 'X-Content-Type-Options:nosniff',
      '--quiet', directory], {
      env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']
    })
    let diagnostic = ''
    let failure
    server.stderr.on('data', (chunk) => {
      diagnostic = (diagnostic + chunk).slice(-MAX_ERROR_CHARS)
    })
    server.once('error', (error) => {
      failure = error
    })
    server.once('close', () => {
      if (!stopping && process.connected) {
        process.send({ error: diagnostic || 'LAN server stopped.' })
      }
      void stop()
    })
    timer = setTimeout(() => void stop(), Math.max(0, Date.parse(input.expiresAt) - Date.now()))
    const deadline = Date.now() + START_TIMEOUT_MS
    while (!stopping && Date.now() < deadline) {
      if (failure) {
        throw failure
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/${input.route}/`, {
          signal: AbortSignal.timeout(PROBE_INTERVAL_MS * 2)
        })
        await response.body?.cancel()
        if (response.ok && process.connected) {
          process.send({ port })
          return
        }
      } catch {
        // The server has been spawned but may not have opened its socket yet.
      }
      await delay(PROBE_INTERVAL_MS)
    }
    throw new Error(`LAN server did not become ready. ${diagnostic}`)
  } catch (error) {
    if (process.connected) {
      process.send({ error: String(error) })
    }
    await stop()
  }
})
