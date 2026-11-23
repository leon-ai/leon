// This entry stays plain Node so Core can run without an Electron process.
import { readFile, mkdir, open, rm, stat } from 'node:fs/promises'
import { createServer, type Server } from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import type { ServiceConfiguration, HostError } from './types.js'

const configuration = JSON.parse(await readFile(process.argv[2]!, 'utf8')) as ServiceConfiguration
const { node, codebase, environment, controlPath, controlToken, directory } = configuration
const lock = path.join(directory, 'runner.lock')
let child: ChildProcess | undefined
let stopping = false
let server: Server | undefined

async function acquireLock(): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(lock)
      const file = await open(path.join(lock, 'pid'), 'w', 0o600)
      await file.writeFile(String(process.pid))
      await file.close()
      return
    } catch (error) {
      if ((error as HostError).code !== 'EEXIST') {
        throw error
      }
      const pid = Number(await readFile(path.join(lock, 'pid'), 'utf8').catch(() => ''))
      if (pid > 0) {
        try {
          process.kill(pid, 0)
          process.exit(0)
        } catch (probeError) {
          if ((probeError as HostError).code !== 'ESRCH') {
            throw probeError
          }
        }
      } else if (Date.now() - (await stat(lock)).mtimeMs < 30_000) {
        process.exit(0)
      }
      await rm(lock, { recursive: true, force: true })
    }
  }
  throw new Error('Could not acquire the Core service lock')
}

async function stop(): Promise<void> {
  if (stopping) {
    return
  }
  stopping = true
  server?.close()
  if (child && process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    killer.on('error', console.error)
  } else {
    child?.kill('SIGTERM')
  }
  if (!child) {
    await cleanup()
    process.exit(0)
  }
}

async function cleanup(): Promise<void> {
  await rm(lock, { recursive: true, force: true })
  if (process.platform !== 'win32') {
    await rm(controlPath, { force: true })
  }
}

async function launch(script: string): Promise<void> {
  let selectedNode = node
  let selectedCodebase = codebase
  if (configuration.runtimeHome) {
    const active = JSON.parse(await readFile(path.join(configuration.runtimeHome, 'active.json'), 'utf8'))
    if (typeof active.version !== 'string' || path.basename(active.version) !== active.version ||
      path.win32.basename(active.version) !== active.version || active.version === '..') {
      throw new Error('Invalid active runtime selection')
    }
    selectedCodebase = path.join(configuration.runtimeHome, 'versions', active.version)
    selectedNode = path.join(selectedCodebase, 'runtime/node', process.platform === 'win32' ? 'node.exe' : 'bin/node')
  }
  return new Promise<void>((resolve, reject) => {
    child = spawn(selectedNode, [path.join(selectedCodebase, 'scripts/run-with-managed-node.js'), script], {
      cwd: selectedCodebase, env: { ...environment, LEON_NODE_ENV: 'production' }, stdio: 'inherit', windowsHide: true
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      child = undefined
      if (stopping || code === 0) {
        resolve()
      } else {
        reject(new Error(`Core exited with ${signal ?? code}`))
      }
    })
  })
}

await mkdir(directory, { recursive: true, mode: 0o700 })
await acquireLock()
try {
  if (process.platform !== 'win32') {
    await rm(controlPath, { force: true })
  }
  server = createServer((socket) => {
    socket.setTimeout(2_000, () => socket.destroy())
    let text = ''
    socket.on('data', (chunk) => {
      text += chunk
      if (text.length > 4_096) {
        socket.destroy()
        return
      }
      if (!text.includes('\n')) {
        return
      }
      try {
        const request = JSON.parse(text)
        if (request.token !== controlToken) {
          socket.destroy()
          return
        }
        socket.end(JSON.stringify({ running: !stopping, pid: process.pid }) + '\n')
        if (request.action === 'stop') {
          void stop()
        }
      } catch {
        socket.destroy()
      }
    })
    socket.on('error', () => {})
  })
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject)
    server!.listen(controlPath, resolve)
  })
  process.on('SIGTERM', () => void stop())
  process.on('SIGINT', () => void stop())
  if (!configuration.runtimeHome) {
    await launch('server/dist/pre-check.js')
  }
  if (!stopping) {
    await launch('server/dist/index.js')
  }
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  server?.close()
  await cleanup()
}
