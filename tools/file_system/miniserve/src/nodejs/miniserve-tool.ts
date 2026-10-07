import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fork, type ChildProcess } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { PROFILE_TOOLS_PATH } from '@bridge/constants'
import { ToolRuntimeLifetime } from '@bridge/tool-runtime-types'
import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

const SUPERVISOR = fileURLToPath(new URL('./lib/serve.mjs', import.meta.url))
const DEFAULT_EXPIRY_SECONDS = 3_600
const MAX_EXPIRY_SECONDS = 86_400
const MAX_FILES = 20
const MAX_SHARES = 5
const START_TIMEOUT_MS = 15_000
const STOP_TIMEOUT_MS = 5_000

interface Share {
  child: ChildProcess
  closed: Promise<void>
  sessionId: string | null
  expiresAt: string
  urls: string[]
  files: string[]
}

/**
 * Own finite-lived, read-only LAN servers within the profile's tool worker.
 */
export default class MiniserveTool extends Tool {
  public readonly runtimeLifetime = ToolRuntimeLifetime.Persistent
  private readonly config = ToolkitConfig.load(this.toolkit, this.toolName)
  private readonly shares = new Map<string, Share>()

  get toolName(): string {
    return 'miniserve'
  }

  get toolkit(): string {
    return 'file_system'
  }

  get description(): string {
    return this.config.description
  }

  /**
   * Stage only selected files and return secret URLs after the server is ready.
   */
  public async start(paths: string[], expireSeconds = DEFAULT_EXPIRY_SECONDS): Promise<Record<string, unknown>> {
    if (!Array.isArray(paths) || !paths.length || paths.length > MAX_FILES) {
      throw new Error(`Select between 1 and ${MAX_FILES} files.`)
    }
    if (!Number.isInteger(expireSeconds) || expireSeconds < 1 || expireSeconds > MAX_EXPIRY_SECONDS) {
      throw new Error('expireSeconds must be between 1 and 86400.')
    }
    if (this.shares.size >= MAX_SHARES) {
      throw new Error('Stop an existing share before starting another.')
    }
    let size = 0
    const filenames = new Set<string>()
    for (const source of paths) {
      if (typeof source !== 'string' || !path.isAbsolute(source)) {
        throw new Error('Each file path must be absolute.')
      }
      const stat = await fs.lstat(source)
      const filename = path.basename(source)
      if (!stat.isFile() || filenames.has(filename)) {
        throw new Error('Select regular files with distinct filenames; symlinks are not shared.')
      }
      filenames.add(filename)
      size += stat.size
    }

    const binary = await this.getBinaryPath('miniserve')
    const root = path.join(PROFILE_TOOLS_PATH, this.toolkit, this.toolName, 'shares')
    await fs.mkdir(root, { recursive: true, mode: 0o700 })
    const directory = await fs.mkdtemp(path.join(root, 'share-'))
    const id = randomUUID()
    const route = randomBytes(24).toString('hex')
    let child: ChildProcess | undefined
    let closed: Promise<void> | undefined
    try {
      for (const source of paths) {
        await fs.copyFile(source, path.join(directory, path.basename(source)))
      }
      this.executionContext?.signal?.throwIfAborted()
      const expiresAt = new Date(Date.now() + expireSeconds * 1_000).toISOString()
      // A separate supervisor gets IPC disconnect even if the worker is killed.
      // It owns expiry and staged-file cleanup, so the HTTP child cannot linger.
      child = fork(SUPERVISOR, [], {
        execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc']
      })
      const server = child
      server.stderr?.resume()
      closed = new Promise<void>((resolve) => {
        const finish = (): void => {
          this.shares.delete(id)
          resolve()
        }
        server.once('exit', finish)
        server.once('error', finish)
      })
      const port = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => finish(new Error('LAN share startup timed out.')), START_TIMEOUT_MS)
        const cancel = (): void => finish(new Error('LAN share startup canceled.'))
        const failed = (): void => finish(new Error('LAN share server stopped before becoming ready.'))
        const finish = (error?: Error, value?: number): void => {
          clearTimeout(timer)
          this.executionContext?.signal?.removeEventListener('abort', cancel)
          server.off('message', message)
          server.off('error', finish)
          server.off('exit', failed)
          if (error) {
            reject(error)
          } else {
            resolve(value!)
          }
        }
        const message = (value: unknown): void => {
          const response = value as { port?: number, error?: string }
          if (response.error) {
            finish(new Error(response.error))
          } else if (Number.isInteger(response.port) && response.port! > 0) {
            finish(undefined, response.port)
          }
        }
        server.on('message', message)
        server.once('error', finish)
        server.once('exit', failed)
        this.executionContext?.signal?.addEventListener('abort', cancel, { once: true })
        server.send({ binary, directory, route, expiresAt }, (error) => {
          if (error) {
            finish(error)
          }
        })
      })
      this.executionContext?.signal?.throwIfAborted()
      const addresses = Object.values(os.networkInterfaces()).flatMap((network) =>
        (network || []).filter((address) => address.family === 'IPv4' && !address.internal)
          .map((address) => address.address)
      )
      const hosts = [...new Set(['127.0.0.1', ...addresses])]
      const urls = hosts.map((host) => `http://${host}:${port}/${route}/`)
      const files = [...filenames]
      this.shares.set(id, {
        child: server, closed, sessionId: this.executionContext?.conversationSessionId || null,
        expiresAt, urls, files
      })

      return {
        shareId: id, urls, files, sizeBytes: size, expiresAt,
        downloadUrls: urls.flatMap((url) => files.map((file) => `${url}${encodeURIComponent(file)}`)),
        access: 'Read-only HTTP on this device and its LAN; anyone holding the secret URL.'
      }
    } catch (error) {
      if (child && closed) {
        child.kill('SIGTERM')
        await closed
      }
      await fs.rm(directory, { recursive: true, force: true })
      throw error
    }
  }

  /**
   * Revoke only a share created by the current conversation.
   */
  public async stop(shareId: string): Promise<Record<string, unknown>> {
    const share = this.shares.get(shareId)
    if (!share || share.sessionId !== (this.executionContext?.conversationSessionId || null)) {
      throw new Error('No active share with this id in the current conversation.')
    }
    await this.closeShare(share)
    return { shareId, stopped: true }
  }

  /**
   * Expose current conversation handles without leaking another conversation's links.
   */
  public async list(): Promise<Record<string, unknown>> {
    const sessionId = this.executionContext?.conversationSessionId || null
    return {
      shares: [...this.shares].filter(([, share]) => share.sessionId === sessionId)
        .map(([shareId, { urls, files, expiresAt }]) => ({ shareId, urls, files, expiresAt }))
    }
  }

  /**
   * Revoke all profile-owned shares when the retained worker shuts down.
   */
  public async dispose(): Promise<void> {
    await Promise.all([...this.shares.values()].map((share) => this.closeShare(share)))
  }

  private async closeShare(share: Share): Promise<void> {
    share.child.kill('SIGTERM')
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        share.closed,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('LAN share shutdown did not complete.')), STOP_TIMEOUT_MS)
        })
      ])
    } finally {
      clearTimeout(timer)
    }
  }
}
