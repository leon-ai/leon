import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

import { RuntimeHelper } from '@/helpers/runtime-helper'
import { terminateProcessTree } from '@sdk/utils/process'

const MAX_SESSIONS = 64
const MAX_OUTPUT_CHARS = 256_000
const DEFAULT_READ_CHARS = 16_000
const MAX_READ_CHARS = 40_000
const MAX_INPUT_CHARS = 16_000
const DEFAULT_TIMEOUT_MS = 86_400_000
const STOP_GRACE_MS = 500
const STOP_TIMEOUT_MS = 2_000

enum SessionStatus {
  Running = 'running',
  Exited = 'exited',
  Stopped = 'stopped',
  TimedOut = 'timed_out',
  Failed = 'failed'
}

export interface SessionOptions {
  cwd?: string
  pty?: boolean
  timeoutMs?: number
}

export interface SessionReadOptions {
  offsetChars?: number
  maxChars?: number
}

interface Session {
  id: string
  owner: string
  command: string
  cwd: string
  pty: boolean
  pid: number
  output: string
  offset: number
  status: SessionStatus
  alive: boolean
  exitCode: number | null
  signal: string | number | null
  error?: string
  timer?: NodeJS.Timeout
  closed: Promise<void>
  input: (data: string) => Promise<void>
  stopping?: Promise<void>
}

/**
 * Own command sessions in the retained shell worker; each handle has one owner.
 */
export class ShellSessions {
  private readonly sessions = new Map<string, Session>()

  /**
   * Launch one command and return without awaiting its eventual exit.
   */
  public async start(
    owner: string,
    command: string,
    binary: string,
    args: string[],
    options: SessionOptions,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    if (!owner || !command.trim() || signal?.aborted) {
      throw new Error('An active conversation and a non-empty command are required.')
    }

    if (this.sessions.size >= MAX_SESSIONS) {
      const completed = [...this.sessions.values()].find((session) => !session.alive)
      if (!completed) {
        throw new Error('Session limit reached. Stop an existing session first.')
      }
      this.sessions.delete(completed.id)
    }

    const cwd = path.resolve(options.cwd || process.cwd())
    if (!(await fs.stat(cwd)).isDirectory()) {
      throw new Error('Session cwd must be an existing directory.')
    }

    let finish: () => void = () => {}
    const session: Session = {
      id: randomUUID(),
      owner,
      command,
      cwd,
      pty: options.pty === true,
      pid: 0,
      output: '',
      offset: 0,
      status: SessionStatus.Running,
      alive: true,
      exitCode: null,
      signal: null,
      closed: new Promise<void>((resolve) => {
        finish = resolve
      }),
      input: async () => {
        throw new Error('Session input is not ready.')
      }
    }
    const append = (data: string): void => {
      const combined = session.output + data
      const removed = Math.max(0, combined.length - MAX_OUTPUT_CHARS)
      session.offset += removed
      session.output = combined.slice(removed)
    }
    const complete = (code: number | null, exitSignal: string | number | null): void => {
      session.alive = false
      session.exitCode = code
      session.signal = exitSignal
      clearTimeout(session.timer)
      if (session.status === SessionStatus.Running) {
        session.status = SessionStatus.Exited
      }
      finish()
    }

    const env = RuntimeHelper.getManagedNodeEnvironment()
    if (session.pty) {
      const { spawn: spawnPty } = await import('node-pty')
      const terminal = spawnPty(binary, args, { cwd, env, cols: 120, rows: 30 })
      session.pid = terminal.pid
      terminal.onData(append)
      terminal.onExit((event) => {
        complete(event.exitCode, event.signal ?? null)
      })
      session.input = async (data): Promise<void> => {
        terminal.write(data)
      }
    } else {
      const child = spawn(binary, args, {
        cwd,
        env,
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })
      child.stdout.setEncoding('utf8').on('data', append)
      child.stderr.setEncoding('utf8').on('data', append)
      child.stdin.on('error', (error) => {
        session.error = error.message
      })
      child.on('error', (error) => {
        session.error = error.message
        session.status = SessionStatus.Failed
      })
      child.once('close', complete)
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve)
        child.once('error', reject)
      })
      session.pid = child.pid!
      session.input = (data): Promise<void> => new Promise<void>((resolve, reject) => {
        child.stdin.write(data, (error) => {
          if (error) {
            reject(error)
          } else {
            resolve()
          }
        })
      })
    }

    this.sessions.set(session.id, session)
    if (signal?.aborted) {
      await this.terminate(session, SessionStatus.Stopped)
      throw new Error('Session launch canceled.')
    }

    if (session.alive) {
      session.timer = setTimeout(() => {
        void this.terminate(session, SessionStatus.TimedOut).catch((error: unknown) => {
          session.error = String(error)
        })
      }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
      session.timer.unref()
    }

    return this.read(owner, session.id)
  }

  /**
   * Return a bounded output page with an absolute continuation cursor.
   */
  public read(owner: string, id: string, options: SessionReadOptions = {}): Record<string, unknown> {
    const session = this.get(owner, id)
    const requested = options.offsetChars ?? 0
    const offset = Math.max(session.offset, Math.min(requested, session.offset + session.output.length))
    const limit = Math.min(options.maxChars ?? DEFAULT_READ_CHARS, MAX_READ_CHARS)
    const output = session.output.slice(offset - session.offset, offset - session.offset + limit)

    return {
      sessionId: session.id,
      pid: session.pid,
      command: session.command,
      cwd: session.cwd,
      pty: session.pty,
      status: session.status,
      running: session.alive,
      exitCode: session.exitCode,
      signal: session.signal,
      commandSucceeded: session.alive ? null : session.exitCode === 0 && session.status === SessionStatus.Exited,
      output,
      offsetChars: offset,
      nextOffsetChars: offset + output.length,
      hasMore: offset + output.length < session.offset + session.output.length,
      outputLost: requested < session.offset,
      ...(session.error ? { error: session.error } : {})
    }
  }

  /**
   * Deliver bounded stdin to the command belonging to this conversation.
   */
  public async write(owner: string, id: string, data: string): Promise<Record<string, unknown>> {
    const session = this.get(owner, id)
    if (!session.alive || data.length > MAX_INPUT_CHARS) {
      throw new Error('Session must be running and input must fit the input limit.')
    }

    await session.input(data)
    return this.read(owner, id)
  }

  /**
   * Stop the owned process tree and retain its final output for inspection.
   */
  public async stop(owner: string, id: string): Promise<Record<string, unknown>> {
    const session = this.get(owner, id)
    await this.terminate(session, SessionStatus.Stopped)
    return this.read(owner, id)
  }

  /**
   * Release all children when the worker shuts down or loses its host.
   */
  public async dispose(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((session) =>
      this.terminate(session, SessionStatus.Stopped)
    ))
    this.sessions.clear()
  }

  private get(owner: string, id: string): Session {
    const session = this.sessions.get(id)
    if (!owner || !session || session.owner !== owner) {
      throw new Error('Session is unavailable in this conversation.')
    }
    return session
  }

  private async terminate(session: Session, status: SessionStatus): Promise<void> {
    if (!session.alive) {
      return
    }
    if (session.stopping) {
      return session.stopping
    }

    session.status = status
    clearTimeout(session.timer)
    session.stopping = this.stopTree(session)
    return session.stopping
  }

  private async stopTree(session: Session): Promise<void> {
    const kill = async (signal: NodeJS.Signals): Promise<void> => {
      if (process.platform !== 'win32') {
        try {
          // Both detached pipes and Unix PTYs own a separate process group.
          process.kill(-session.pid, signal)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
            throw error
          }
        }
      } else {
        try {
          await terminateProcessTree(session.pid, signal)
        } catch (error) {
          if (session.alive) {
            throw error
          }
        }
      }
    }

    await kill('SIGTERM')
    // Allow graceful exit, then remove descendants that ignored the first signal.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, STOP_GRACE_MS)
    })
    await kill('SIGKILL')
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        session.closed,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Session cleanup did not complete.')), STOP_TIMEOUT_MS)
        })
      ])
    } finally {
      clearTimeout(timer)
    }
  }
}
