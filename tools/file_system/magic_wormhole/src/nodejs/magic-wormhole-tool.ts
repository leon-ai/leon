import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { fork, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { PROFILE_TOOLS_PATH } from '@bridge/constants'
import { ToolRuntimeLifetime } from '@bridge/tool-runtime-types'
import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

const SUPERVISOR = fileURLToPath(new URL('./lib/send.mjs', import.meta.url))
const DEFAULT_SETTINGS = { browser_receive_url: 'https://wormhole.page/' }
const DEFAULT_EXPIRY_SECONDS = 3_600
const MAX_EXPIRY_SECONDS = 86_400
const MAX_ACTIVE_TRANSFERS = 5
const MAX_TRANSFER_HISTORY = 20
const BROWSER_MEMORY_LIMIT_BYTES = 512 * 1_024 * 1_024
const START_TIMEOUT_MS = 30_000
const STOP_TIMEOUT_MS = 5_000

enum TransferStatus {
  Waiting = 'waiting',
  Completed = 'completed',
  Failed = 'failed',
  Expired = 'expired',
  Stopped = 'stopped'
}

interface Transfer {
  child: ChildProcess
  closed: Promise<void>
  sessionId: string
  filename: string
  sizeBytes: number
  expiresAt: string
  status: TransferStatus
  code?: string
  transferUri?: string
  browserReceiveUrl?: string
}

/**
 * Own one-recipient, encrypted internet transfers with finite process lifetimes.
 */
export default class MagicWormholeTool extends Tool {
  public readonly runtimeLifetime = ToolRuntimeLifetime.Persistent
  private readonly config = ToolkitConfig.load(this.toolkit, this.toolName)
  private readonly transfers = new Map<string, Transfer>()

  constructor() {
    super()
    this.settings = ToolkitConfig.loadToolSettings(
      this.toolkit, this.toolName, DEFAULT_SETTINGS
    )
  }

  get toolName(): string {
    return 'magic_wormhole'
  }

  get toolkit(): string {
    return 'file_system'
  }

  get description(): string {
    return this.config.description
  }

  /**
   * Snapshot one selected file and return its code once the mailbox is ready.
   */
  public async share(
    filePath: string,
    expireSeconds = DEFAULT_EXPIRY_SECONDS
  ): Promise<Record<string, unknown>> {
    const sessionId = this.executionContext?.conversationSessionId
    const signal = this.executionContext?.signal
    if (!sessionId) {
      throw new Error('Transfers require a conversation session.')
    }
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
      throw new Error('filePath must be absolute.')
    }
    if (!Number.isInteger(expireSeconds) || expireSeconds < 1 ||
        expireSeconds > MAX_EXPIRY_SECONDS) {
      throw new Error(`expireSeconds must be between 1 and ${MAX_EXPIRY_SECONDS}.`)
    }
    const stat = await fs.lstat(filePath)
    if (!stat.isFile()) {
      throw new Error('Select a regular file; symlinks and directories are not shared.')
    }
    if ([...this.transfers.values()].filter((transfer) =>
      transfer.status === TransferStatus.Waiting
    ).length >= MAX_ACTIVE_TRANSFERS) {
      throw new Error('Stop an existing transfer before starting another.')
    }
    const receiver = new URL(String(this.settings['browser_receive_url']))
    if (receiver.protocol !== 'https:' || receiver.username || receiver.password) {
      throw new Error('browser_receive_url must be an HTTPS URL without credentials.')
    }

    const binary = await this.getBinaryPath('wormhole-rs')
    const root = path.join(PROFILE_TOOLS_PATH, this.toolkit, this.toolName, 'transfers')
    await fs.mkdir(root, { recursive: true, mode: 0o700 })
    const directory = await fs.mkdtemp(path.join(root, 'transfer-'))
    const transferId = randomUUID()
    const filename = path.basename(filePath)
    let transfer: Transfer | undefined

    try {
      // Reflink when supported, otherwise copy: the recipient gets a snapshot
      // without exposing the source directory or reading the file into RAM.
      const file = path.join(directory, filename)
      await fs.copyFile(filePath, file, constants.COPYFILE_FICLONE)
      signal?.throwIfAborted()
      const expiresAt = new Date(Date.now() + expireSeconds * 1_000).toISOString()
      const child = fork(SUPERVISOR, [], {
        execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc']
      })
      const closed = new Promise<void>((resolve) => {
        child.once('exit', resolve)
        child.once('error', resolve)
      })
      transfer = {
        child, closed, sessionId, filename, sizeBytes: stat.size, expiresAt,
        status: TransferStatus.Waiting
      }
      const current = transfer
      child.on('message', (message: { status?: TransferStatus }) => {
        if (message.status && Object.values(TransferStatus).includes(message.status)) {
          current.status = message.status
        }
      })
      child.once('exit', () => {
        if (current.status === TransferStatus.Waiting) {
          current.status = TransferStatus.Failed
        }
      })

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => finish(new Error('Transfer startup timed out.')),
          START_TIMEOUT_MS)
        const cancel = (): void => finish(new Error('Transfer startup canceled.'))
        const exited = (): void => finish(new Error('Transfer stopped before its code was ready.'))
        const finish = (error?: Error): void => {
          clearTimeout(timer)
          signal?.removeEventListener('abort', cancel)
          child.off('message', ready)
          child.off('error', finish)
          child.off('exit', exited)
          if (error) {
            reject(error)
          } else {
            resolve()
          }
        }
        const ready = (message: { code?: string, transferUri?: string }): void => {
          if (message.code && message.transferUri) {
            current.code = message.code
            current.transferUri = message.transferUri
            // Automatic reception has no user activation for the save picker.
            // Large files need the receiver page's explicit Receive button.
            current.browserReceiveUrl = stat.size > BROWSER_MEMORY_LIMIT_BYTES
              ? receiver.href
              : new URL(`receive/${encodeURIComponent(message.code)}`, receiver).href
            finish()
          }
        }
        child.on('message', ready)
        child.once('error', finish)
        child.once('exit', exited)
        signal?.addEventListener('abort', cancel, { once: true })
        child.send({ binary, directory, file, expiresAt }, (error) => {
          if (error) {
            finish(error)
          }
        })
      })
      signal?.throwIfAborted()
      for (const [id, previous] of this.transfers) {
        if (this.transfers.size < MAX_TRANSFER_HISTORY) {
          break
        }
        if (previous.status !== TransferStatus.Waiting) {
          this.transfers.delete(id)
        }
      }
      this.transfers.set(transferId, current)

      return {
        ...this.summary(transferId, current),
        browserHomeUrl: receiver.href,
        browserRequiresCodeEntry: stat.size > BROWSER_MEMORY_LIMIT_BYTES,
        access: 'One recipient holding the code; end-to-end encrypted; the sender must stay online.',
        browserGuidance: 'For files over 512 MiB, open browserHomeUrl in Chrome or Edge, enter the code and click Receive to allow saving to disk. Other browsers may require a Wormhole client.'
      }
    } catch (error) {
      if (transfer) {
        await this.closeTransfer(transfer)
      }
      await fs.rm(directory, { recursive: true, force: true })
      throw error
    }
  }

  /**
   * Inspect only transfers belonging to the current conversation.
   */
  public async list(): Promise<Record<string, unknown>> {
    const sessionId = this.executionContext?.conversationSessionId
    return {
      transfers: [...this.transfers].filter(([, transfer]) =>
        transfer.sessionId === sessionId
      ).map(([id, transfer]) => this.summary(id, transfer))
    }
  }

  /**
   * Revoke an active transfer owned by this conversation.
   */
  public async stop(transferId: string): Promise<Record<string, unknown>> {
    const transfer = this.transfers.get(transferId)
    if (!transfer || transfer.sessionId !== this.executionContext?.conversationSessionId) {
      throw new Error('No transfer with this id in the current conversation.')
    }
    if (transfer.status === TransferStatus.Waiting) {
      await this.closeTransfer(transfer)
    }
    return this.summary(transferId, transfer)
  }

  /**
   * Stop all remaining transfers when the profile's retained worker shuts down.
   */
  public async dispose(): Promise<void> {
    await Promise.all([...this.transfers.values()].filter((transfer) =>
      transfer.status === TransferStatus.Waiting
    ).map((transfer) => this.closeTransfer(transfer)))
  }

  /**
   * Exclude process handles and conversation identifiers from tool results.
   */
  private summary(id: string, transfer: Transfer): Record<string, unknown> {
    const { filename, sizeBytes, expiresAt, status, code, transferUri, browserReceiveUrl } = transfer
    return { transferId: id, filename, sizeBytes, expiresAt, status, code, transferUri, browserReceiveUrl }
  }

  /**
   * Wait for supervisor cleanup before reporting revocation.
   */
  private async closeTransfer(transfer: Transfer): Promise<void> {
    transfer.child.kill('SIGTERM')
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        transfer.closed,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Transfer shutdown did not complete.')),
            STOP_TIMEOUT_MS)
        })
      ])
    } finally {
      clearTimeout(timer)
    }
  }
}
