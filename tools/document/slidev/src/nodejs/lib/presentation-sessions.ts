import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { RuntimeHelper } from '@/helpers/runtime-helper'
import { terminateProcessTree } from '@sdk/utils/process'

const SERVER_PATH = fileURLToPath(new URL('./present.mjs', import.meta.url))
const MAX_PRESENTATIONS = 8
const START_TIMEOUT_MS = 60_000
const STOP_TIMEOUT_MS = 5_000
const OPEN_TIMEOUT_MS = 8_000
const MAX_DIAGNOSTIC_CHARACTERS = 20_000

/**
 * Select the native Slidev view to open on the machine executing this tool.
 */
export enum PresentationView {
  Audience = 'audience',
  Presenter = 'presenter'
}

interface Presentation {
  id: string
  owner: string
  entry: string
  child: ChildProcess
  closed: Promise<void>
  urls: { audienceUrl: string, presenterUrl: string }
}

/**
 * Own live decks in the retained profile worker and isolate conversation handles.
 */
export class PresentationSessions {
  private readonly sessions = new Map<string, Presentation>()

  /**
   * Reuse the owner's live deck or start a server and verify its native routes.
   */
  public async present(
    owner: string,
    entry: string,
    view: PresentationView,
    openBrowser: boolean,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    if (signal?.aborted) {
      throw new Error('Presentation launch canceled.')
    }

    let session = [...this.sessions.values()].find((item) =>
      item.owner === owner && item.entry === entry
    )
    const reused = Boolean(session)

    if (!session) {
      if (this.sessions.size >= MAX_PRESENTATIONS) {
        throw new Error(`Stop an existing presentation before opening more than ${MAX_PRESENTATIONS} decks.`)
      }

      session = await this.start(owner, entry, signal)
      this.sessions.set(session.id, session)
    }

    const url = view === PresentationView.Presenter
      ? session.urls.presenterUrl
      : session.urls.audienceUrl
    let browserOpened = false
    let browserError: string | undefined

    if (openBrowser) {
      try {
        await this.openBrowser(url)
        browserOpened = true
      } catch (error) {
        // A headless server can still serve the deck; report opening separately.
        browserError = (error as Error).message
      }
    }

    return {
      sessionId: session.id,
      ...session.urls,
      url,
      running: true,
      reused,
      view,
      browserOpened,
      ...(browserError ? { browserError } : {}),
      urlScope: 'tool-host',
      controls: { next: 'Space / ArrowRight', previous: 'ArrowLeft', fullscreen: 'f' }
    }
  }

  /**
   * Stop only a presentation owned by the calling conversation.
   */
  public async stop(owner: string, id: string): Promise<Record<string, unknown>> {
    const session = this.sessions.get(id)

    if (!session || session.owner !== owner) {
      throw new Error('Presentation is unavailable in this conversation.')
    }

    await this.close(session)

    return { sessionId: id, running: false }
  }

  /**
   * Release every presentation on worker shutdown or Satellite disconnection.
   */
  public async dispose(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((session) => this.close(session)))
  }

  /**
   * Keep the server in a child so its dependencies and process state stay local.
   */
  private async start(owner: string, entry: string, signal?: AbortSignal): Promise<Presentation> {
    const child = spawn(RuntimeHelper.getNodeBinPath(), [SERVER_PATH, entry], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env: RuntimeHelper.getManagedNodeEnvironment(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    })
    const session: Presentation = {
      id: randomUUID(),
      owner,
      entry,
      child,
      // IPC is disconnected before exit, so await the process rather than the
      // stdio close event, which is not guaranteed after an IPC disconnect.
      closed: new Promise((resolve) => {
        child.once('exit', () => resolve())
        child.once('error', () => resolve())
      }),
      urls: { audienceUrl: '', presenterUrl: '' }
    }
    let diagnostics = ''
    const append = (data: Buffer): void => {
      diagnostics = (diagnostics + data.toString()).slice(-MAX_DIAGNOSTIC_CHARACTERS)
    }

    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    child.once('exit', () => this.sessions.delete(session.id))

    let timer: NodeJS.Timeout | undefined
    let cancel: (() => void) | undefined

    try {
      session.urls = await new Promise<Presentation['urls']>((resolve, reject) => {
        cancel = (): void => reject(new Error('Presentation launch canceled.'))
        child.once('error', reject)
        child.once('exit', () => reject(new Error(`Presentation server exited. ${diagnostics}`)))
        child.once('message', (message: Presentation['urls']) => resolve(message))
        signal?.addEventListener('abort', cancel, { once: true })
        timer = setTimeout(() => reject(new Error(`Presentation did not start. ${diagnostics}`)), START_TIMEOUT_MS)

        if (signal?.aborted) {
          cancel()
        }
      })

      return session
    } catch (error) {
      await this.close(session)
      throw error
    } finally {
      clearTimeout(timer)

      if (cancel) {
        signal?.removeEventListener('abort', cancel)
      }
    }
  }

  /**
   * Allow native shutdown before terminating a server that cannot release itself.
   */
  private async close(session: Presentation): Promise<void> {
    let timer: NodeJS.Timeout | undefined

    if (session.child.connected) {
      session.child.disconnect()
    }

    try {
      const forced = new Promise<void>((resolve, reject) => {
        timer = setTimeout(() => {
          if (session.child.pid) {
            terminateProcessTree(session.child.pid, 'SIGKILL').then(resolve, reject)
          }
        }, STOP_TIMEOUT_MS)
      })
      await Promise.race([session.closed, forced])
      await session.closed
    } finally {
      clearTimeout(timer)
      this.sessions.delete(session.id)
    }
  }

  /**
   * Respect the host's default browser without treating headless serving as opening.
   */
  private async openBrowser(url: string): Promise<void> {
    if (process.platform === 'linux' && !process.env['DISPLAY'] && !process.env['WAYLAND_DISPLAY']) {
      throw new Error('No desktop session on the tool host. Run Slidev on your device through Satellite to open its browser.')
    }

    const command = process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32' ? 'rundll32.exe' : 'xdg-open'
    const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url]

    await new Promise<void>((resolve, reject) => {
      execFile(command, args, { timeout: OPEN_TIMEOUT_MS }, (error) => {
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      })
    })
  }
}
