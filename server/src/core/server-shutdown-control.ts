import fs from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { tmpdir, userInfo } from 'node:os'
import path from 'node:path'

const REQUEST_LIMIT = 4_096
const REQUEST_TIMEOUT_MS = 1_000

/**
 * Keeps checkout-specific control files outside build output and profile state.
 */
export function serverShutdownControlDirectory(codebase: string): string {
  const root = fs.realpathSync(codebase)
  const identity = createHash('sha256')
    .update(JSON.stringify([userInfo().username, root]))
    .digest('hex').slice(0, 20)

  return path.join(tmpdir(), `leon-core-${identity}`)
}

/**
 * Gives clients the checkout-scoped address for the server's shutdown endpoint.
 */
export function serverShutdownControlPath(directory: string, id: string): string {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\${path.basename(directory)}-${id}`
    : path.join(directory, `${id}.sock`)
}

/**
 * Rejects a control directory that another local user could have prepared.
 */
export async function verifyServerShutdownControlDirectory(directory: string): Promise<void> {
  const info = await fs.promises.lstat(directory)
  const uid = process.getuid?.()

  if (!info.isDirectory() || (uid !== undefined && (info.uid !== uid || (info.mode & 0o022) !== 0))) {
    throw new Error('I could not verify ownership of the server shutdown control directory.')
  }
}

/**
 * Exposes an authenticated local endpoint for the server's normal shutdown.
 */
export async function registerServerShutdownControl(codebase: string, stop: () => void): Promise<void> {
  const directory = serverShutdownControlDirectory(codebase)
  const id = `${process.pid}-${randomBytes(4).toString('hex')}`
  const controlPath = serverShutdownControlPath(directory, id)
  const controlToken = randomBytes(32).toString('hex')
  const record = path.join(directory, `${id}.json`)
  const temporaryPath = `${record}.pending`
  const server = createServer((socket) => {
    let text = ''
    socket.setTimeout(REQUEST_TIMEOUT_MS, () => socket.destroy())
    socket.on('error', () => {})
    socket.on('data', (chunk) => {
      text += chunk
      if (text.length > REQUEST_LIMIT) {
        socket.destroy()
        return
      }
      if (!text.includes('\n')) {
        return
      }

      let request: { token?: string, action?: string } | null
      try {
        request = JSON.parse(text)
      } catch {
        socket.destroy()
        return
      }
      if (request?.token !== controlToken || request.action !== 'stop') {
        socket.destroy()
        return
      }

      socket.end(JSON.stringify({ running: true, pid: process.pid }) + '\n', stop)
    })
  })

  await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 })
  await verifyServerShutdownControlDirectory(directory)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(controlPath, resolve)
  })
  server.unref()

  try {
    await fs.promises.writeFile(temporaryPath, JSON.stringify({ controlToken }), { flag: 'wx', mode: 0o600 })
    await fs.promises.rename(temporaryPath, record)
  } catch (error) {
    server.close()
    await fs.promises.rm(temporaryPath, { force: true })
    throw error
  }

  process.once('exit', () => {
    try {
      fs.rmSync(record, { force: true })
      if (process.platform !== 'win32') {
        fs.rmSync(controlPath, { force: true })
      }
    } catch {
      // Shutdown must complete even if the OS already removed the temp directory.
    }
  })
}
