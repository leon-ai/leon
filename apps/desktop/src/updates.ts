import { EventEmitter } from 'node:events'
import type { AppUpdater } from 'electron-updater'
import type { AppUpdaterEvents } from 'electron-updater/out/AppUpdater'
import type { DesktopUpdateSnapshot, UpdateState } from '../../../bridges/runtime/contracts/updates'
import type { HostAPI } from './types.js'

export interface DesktopUpdater {
  state: DesktopUpdateSnapshot
  events: EventEmitter
  check: () => Promise<DesktopUpdateSnapshot>
  download: (version: string) => Promise<DesktopUpdateSnapshot>
  install: (version: string) => Promise<void>
  start: () => void
  close: () => void
}
import { UPDATE_CHECK_INTERVAL_MS, UPDATE_CHECK_JITTER_MS } from '../runtime/bootstrap-runtime.mjs'

const INITIAL_CHECK_DELAY_MS = 10_000
const PUBLISH_INTERVAL_MS = 200
const MAXIMUM_RELEASE_NOTES = 100_000

/**
 * Owns native update state independently of the server, exposing only bounded metadata.
 * The packaged updater verifies checksums/signatures and installs its own files.
 */
export function createDesktopUpdater({ engine, currentVersion, beforeInstall, reason }: {
  engine?: AppUpdater | undefined
  currentVersion: string
  beforeInstall?: () => Promise<void>
  reason?: string | null
}): DesktopUpdater {
  const events = new EventEmitter()
  const state: DesktopUpdateSnapshot = { supported: Boolean(engine), currentVersion, phase: 'idle', version: null,
    releaseNotes: '', progress: null, error: null, reason: reason ?? null }
  const listeners: (() => void)[] = []
  let timer: NodeJS.Timeout | undefined
  let publishTimer: NodeJS.Timeout | undefined
  let pending: Promise<DesktopUpdateSnapshot> | undefined
  let closed = false
  const publish = (value: Partial<DesktopUpdateSnapshot>): void => {
    Object.assign(state, value)
    if (!closed && !publishTimer) {
      publishTimer = setTimeout(() => {
        publishTimer = undefined
        events.emit('change', state)
      }, PUBLISH_INTERVAL_MS)
      publishTimer.unref()
    }
  }
  const fail = (error: unknown): void => publish({ phase: 'failed', error: error instanceof Error ? error.message : String(error), progress: null })
  const listen = <Name extends keyof AppUpdaterEvents>(name: Name, handler: AppUpdaterEvents[Name]): void => {
    engine!.on(name, handler)
    listeners.push(() => engine!.off(name, handler))
  }
  if (engine) {
    // The feed URL already selects preview/stable. Both pointers carry the
    // packager's latest*.yml names rather than alpha/beta metadata filenames.
    engine.channel = 'latest'
    engine.allowPrerelease = currentVersion.includes('-')
    engine.autoDownload = true
    engine.autoInstallOnAppQuit = false
    engine.allowDowngrade = false
    listen('checking-for-update', () => publish({ phase: 'checking', error: null }))
    listen('update-not-available', () => publish({ phase: 'idle', version: null, error: null }))
    listen('update-available', (info) => publish({ phase: 'downloading', version: info.version,
      releaseNotes: String(typeof info.releaseNotes === 'string' ? info.releaseNotes :
        (info.releaseNotes ?? []).map((item) => item.note).join('\n')).slice(0, MAXIMUM_RELEASE_NOTES), error: null }))
    listen('download-progress', (progress) => publish({ phase: 'downloading',
      progress: { downloadedBytes: progress.transferred, totalBytes: progress.total } }))
    listen('update-downloaded', (info) => {
      if (info.version !== state.version) {
        fail(new Error('My prepared desktop version changed. Check for updates again.'))
        return
      }
      publish({ phase: 'ready', progress: null, error: null })
    })
    listen('error', fail)
  }
  const run = (operation: () => Promise<DesktopUpdateSnapshot>): Promise<DesktopUpdateSnapshot> => {
    if (!engine) {
      throw new Error(state.reason ?? 'This desktop installation does not support automatic updates.')
    }
    pending ??= Promise.resolve().then(operation).catch((error) => {
      fail(error)
      throw error
    }).finally(() => {
      pending = undefined
    })
    return pending
  }
  const controller: DesktopUpdater = {
    state, events,
    check() {
      // Keep a verified prepared package pinned until the owner installs it.
      if (['ready', 'installing', 'downloading'].includes(state.phase)) {
        return Promise.resolve(state)
      }
      return run(async () => {
        const result = await engine!.checkForUpdates()
        void result?.downloadPromise?.catch(fail)
        return state
      })
    },
    download(version) {
      if (state.phase !== 'available' || state.version !== version) {
        throw new Error('Check my desktop update again before downloading.')
      }
      publish({ phase: 'downloading', error: null })
      return run(async () => {
        await engine!.downloadUpdate()
        return state
      })
    },
    async install(version) {
      if (state.phase !== 'ready' || state.version !== version) {
        throw new Error('My verified desktop update is not ready to install.')
      }
      try {
        await beforeInstall?.()
        publish({ phase: 'installing' })
        engine!.quitAndInstall(false, true)
      } catch (error) {
        fail(error)
        throw error
      }
    },
    start() {
      if (!engine || timer) {
        return
      }
      const check = async (): Promise<void> => {
        await controller.check().catch(() => undefined)
        if (!closed) {
          timer = setTimeout(check, UPDATE_CHECK_INTERVAL_MS + Math.floor(Math.random() * UPDATE_CHECK_JITTER_MS))
          timer.unref()
        }
      }
      timer = setTimeout(check, INITIAL_CHECK_DELAY_MS)
      timer.unref()
    },
    close() {
      closed = true
      clearTimeout(timer)
      clearTimeout(publishTimer)
      for (const remove of listeners) {
        remove()
      }
      events.removeAllListeners()
    }
  }
  return controller
}

/**
 * Restricts update commands to the authenticated local gateway. Neither package
 * URLs nor filesystem paths can be supplied by page content.
 */
export function desktopUpdatesAPI(controller: DesktopUpdater, coreStatus?: () => Promise<UpdateState | null | undefined>): HostAPI {
  return async (request, response, url, readBody) => {
    const action = url.pathname.split('/').at(-1)
    if (request.method === 'GET' && action === 'core') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(await coreStatus?.() ?? null))
      return
    }
    if (request.method === 'GET' && action === 'events') {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      let blocked = false
      const send = (): void => {
        if (!blocked) {
          blocked = !response.write(`data: ${JSON.stringify(controller.state)}\n\n`)
        }
      }
      const drain = (): void => {
        blocked = false
        send()
      }
      controller.events.on('change', send)
      response.on('drain', drain)
      request.on('close', () => {
        controller.events.off('change', send)
        response.off('drain', drain)
      })
      send()
      return
    }
    if (request.method === 'GET' && action === 'state') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(controller.state))
      return
    }
    if (request.method !== 'POST') {
      response.writeHead(405).end()
      return
    }
    const body = JSON.parse((await readBody(request, 4_096)).toString() || '{}')
    if (action === 'check') {
      await controller.check()
    } else if (action === 'download' && typeof body.version === 'string') {
      // Acknowledge before a potentially long download. Events carry progress.
      void controller.download(body.version).catch(() => undefined)
    } else if (action === 'install' && typeof body.version === 'string') {
      if (controller.state.phase !== 'ready' || controller.state.version !== body.version) {
        throw Object.assign(new Error('My desktop update is not ready.'), { status: 409 })
      }
      response.once('finish', () => {
        void controller.install(body.version).catch(console.error)
      })
    } else {
      response.writeHead(404).end()
      return
    }
    response.writeHead(202, { 'content-type': 'application/json' }).end(JSON.stringify(controller.state))
  }
}
