import { spawn, type ChildProcess } from 'node:child_process'
import { stripVTControlCharacters } from 'node:util'

import type { HostError } from './types.js'

export interface CommandOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
  onLine?: (line: string) => void
}

const MAXIMUM_LINE_LENGTH = 8_192
const TERMINATION_GRACE_MS = 5_000

/**
 * Stops the entire owned setup process tree, including nested package scripts.
 */
export function terminateTree(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (!child.pid) {
    return
  }
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    killer.on('error', () => {})
    return
  }
  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    if ((error as HostError).code !== 'ESRCH') {
      throw error
    }
  }
}

/**
 * Streams bounded command output and cancels owned descendants without a shell.
 */
export function runCommand(command: string, args: string[], { cwd, env = process.env, signal, onLine = (): void => {} }: CommandOptions = {}): Promise<void> {
  signal?.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
    let failure: Error | undefined
    let killTimer: NodeJS.Timeout | undefined
    const abort = (): void => {
      terminateTree(child)
      killTimer = setTimeout(() => terminateTree(child, 'SIGKILL'), TERMINATION_GRACE_MS)
      killTimer.unref()
    }
    signal?.addEventListener('abort', abort, { once: true })
    for (const stream of [child.stdout, child.stderr]) {
      let pending = ''
      stream.setEncoding('utf8')
      stream.on('data', (chunk) => {
        pending += chunk
        const lines = pending.split(/[\r\n]/)
        pending = (lines.pop() ?? '').slice(-MAXIMUM_LINE_LENGTH)
        for (const line of lines) {
          onLine(stripVTControlCharacters(line.slice(0, MAXIMUM_LINE_LENGTH)))
        }
      })
      stream.on('end', () => {
        if (pending) {
          onLine(stripVTControlCharacters(pending))
        }
      })
    }
    child.once('error', (error) => {
      failure = error
    })
    child.once('close', (code, exitSignal) => {
      clearTimeout(killTimer)
      signal?.removeEventListener('abort', abort)
      if (signal?.aborted) {
        reject(signal.reason)
      } else if (failure || code !== 0) {
        reject(failure ?? new Error(`${command.split(/[\\/]/).pop()} exited (${exitSignal ?? code}). Check this step’s details.`))
      } else {
        resolve()
      }
    })
  })
}
