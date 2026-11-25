import { app, BrowserWindow, dialog, Menu, MenuItem, nativeTheme, Notification, safeStorage, session, shell } from 'electron'
import path from 'node:path'
import { mkdirSync, readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { bootstrapAPI } from './bootstrap-api.js'
import { completionNotifications } from './notifications.js'
import { requestBackend, readBackendJSON } from './backend.js'
import { DEFAULT_WEB_THEME, DESKTOP_NOTIFICATION_EVENT, type WebTheme } from '../../../bridges/runtime/contracts/desktop-client'
import { createDesktopUpdater, desktopUpdatesAPI } from './updates.js'
import { createGateway } from './gateway.js'
import { configureNavigation, configurePermissions } from './navigation.js'
import { createDesktopState } from './state.js'
import { loadClientURL } from './startup.js'
import { HIDE_WINDOW_MENU_ID, installPasteMenu, pasteAttachments } from './paste.js'
import type { Session } from 'electron'
import type { Gateway } from './gateway.js'
import type { DesktopUpdater } from './updates.js'
import type { DiagnosticConfiguration } from './types.js'

type BootstrapController = Awaited<ReturnType<typeof import('./bootstrap.js').createBootstrap>>
type DesktopState = Awaited<ReturnType<typeof createDesktopState>>

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
app.setName(manifest.productName)
if (process.platform === 'win32') {
  app.setAppUserModelId(manifest.appId)
}
const diagnostics = manifest.diagnostics === true
const background = diagnostics && process.env['LEON_DESKTOP_BACKGROUND'] !== '0'
const nativeThrottling = process.env['LEON_DESKTOP_NATIVE_THROTTLING'] === '1'
const frontend = fileURLToPath(new URL('../web/', import.meta.url))
const icons = fileURLToPath(new URL('../icons/', import.meta.url))
// Match the shared themes while the renderer prepares its first painted frame.
const WINDOW_BACKGROUNDS = { dark: '#000', light: '#FFF' }
const TITLE_BAR_HEIGHT = 36
const MAIN_WINDOW_NAME = 'leon-main'
// Display-name changes must not move existing sessions and preferences. Native
// diagnostics also get an isolated Chromium cache, not just ephemeral app state.
const dataDirectory = diagnostics ? process.env['LEON_DESKTOP_DIAGNOSTIC_DATA']!
  : path.join(app.getPath('appData'), manifest.dataDirectoryName)
mkdirSync(dataDirectory, { recursive: true })
app.setPath('userData', dataDirectory)
let gateway: Gateway | undefined
let window: BrowserWindow | undefined
let state: DesktopState | undefined
let quitting = false
let quitRequested = false
let bootstrapController: BootstrapController | undefined
let configuration: DiagnosticConfiguration = {}
let desktopUpdater: DesktopUpdater
const notifications = new Set<Notification>()
const MAXIMUM_NOTIFICATIONS = 32

async function failStartup(error: unknown): Promise<void> {
  if (diagnostics && process.env['LEON_DESKTOP_REPORT_PATH']) {
    await writeFile(process.env['LEON_DESKTOP_REPORT_PATH'],
      JSON.stringify({ passed: false, phase: 'complete', error: String(error) }))
  }
  console.error(error)
  app.exit(1)
}

if (diagnostics) {
  // Electron otherwise opens a native exception dialog, blocking hidden checks
  // and interrupting the owner's other applications.
  process.on('uncaughtException', (error) => void failStartup(error))
  process.on('unhandledRejection', (error) => void failStartup(error))
}

const ownsInstance = diagnostics || app.requestSingleInstanceLock()
if (!ownsInstance) {
  app.quit()
}
function restoreWindow(): boolean {
  if (!window || window.isDestroyed()) {
    return false
  }
  if (!background) {
    if (window.isMinimized()) {
      window.restore()
    }
    window.show()
    window.focus()
  }
  return true
}

app.on('second-instance', restoreWindow)
app.on('activate', restoreWindow)
app.on('before-quit', () => {
  quitRequested = true
})

// Keep real page visibility while allowing the shared hidden DOM workload to run.
// Electron's backgroundThrottling=false would report a hidden page as visible.
if (background && !nativeThrottling) {
  app.commandLine.appendSwitch('disable-background-timer-throttling')
}

// A hidden benchmark must never activate the app or borrow another app's identity.
if (background && process.platform === 'darwin') {
  app.dock?.hide()
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || quitRequested) {
    app.quit()
  }
})
// Tear down transports only after every window has accepted closing. An owner
// who cancels beforeunload must keep a working connection to the updating Core.
app.on('will-quit', (event) => {
  if (!quitting) {
    event.preventDefault()
    quitting = true
    desktopUpdater?.close()
    for (const notification of notifications) {
      notification.close()
    }
    notifications.clear()
    void Promise.all([state?.close(), bootstrapController?.close()]).finally(() => {
      gateway?.close()
      // Electron resets its quit guard after this callback returns. Resuming
      // inside a resolved promise can otherwise leave a windowless app alive.
      setImmediate(() => app.quit())
    })
  }
})

function clientTheme(): WebTheme {
  const scheme = state?.colorScheme ?? DEFAULT_WEB_THEME

  return scheme === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : scheme
}

function updateWindowAppearance(): void {
  if (window && !window.isDestroyed()) {
    const theme = clientTheme()

    window.setBackgroundColor(WINDOW_BACKGROUNDS[theme])
    if (process.platform !== 'darwin') {
      window.setTitleBarOverlay({ color: WINDOW_BACKGROUNDS[theme],
        symbolColor: WINDOW_BACKGROUNDS[theme === 'dark' ? 'light' : 'dark'] })
    }
  }
}

function createWindow(clientSession: Session): BrowserWindow {
  const theme = clientTheme()
  const target = new BrowserWindow({
    name: MAIN_WINDOW_NAME,
    // Electron persists geometry and handles changes to the display layout.
    // Hidden checks restore bounds without activating a saved fullscreen mode.
    windowStatePersistence: { bounds: true, displayMode: !background },
    title: manifest.productName,
    width: configuration.viewport?.width ?? 1_230,
    height: configuration.viewport?.height ?? 820,
    useContentSize: true,
    minWidth: 760,
    minHeight: 560,
    show: false,
    focusable: !background,
    // A diagnostic paint control can exercise decoding without showing a window.
    paintWhenInitiallyHidden: !background || configuration.paint_when_hidden === true,
    backgroundColor: WINDOW_BACKGROUNDS[theme],
    // Draw the exact shared palette beneath the OS-owned window controls.
    titleBarStyle: 'hidden',
    titleBarOverlay: { height: TITLE_BAR_HEIGHT, color: WINDOW_BACKGROUNDS[theme],
      symbolColor: WINDOW_BACKGROUNDS[theme === 'dark' ? 'light' : 'dark'] },
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 14, y: 11 } } : {}),
    ...(process.platform !== 'darwin' ? { icon: path.join(icons, 'dark.png') } : {}),
    webPreferences: {
      session: clientSession,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      backgroundThrottling: true
    }
  })
  target.webContents.on('page-title-updated', (event) => event.preventDefault())
  target.on('close', (event) => {
    if (process.platform === 'darwin' && !quitRequested && !quitting) {
      // Keep the draft and live completion stream while macOS hides the window.
      // Native background throttling pauses unnecessary renderer work.
      event.preventDefault()
      target.hide()
    }
  })
  target.once('ready-to-show', () => {
    if (!background && !target.isDestroyed()) {
      target.show()
    }
  })
  target.webContents.on('will-prevent-unload', (event) => {
    if (quitting) {
      event.preventDefault()
      return
    }
    const choice = dialog.showMessageBoxSync(target, {
      type: 'question', buttons: ['Keep open', 'Close window'], defaultId: 0, cancelId: 0,
      message: 'Close this window while I’m updating?',
      detail: 'I’ll keep updating my Core in the background. You can reopen this window to check progress.'
    })
    if (choice === 1) {
      // Electron uses preventDefault here to allow the renderer's blocked unload.
      event.preventDefault()
    } else {
      quitRequested = false
    }
  })

  return target
}

async function installDiagnosticScript(target: BrowserWindow): Promise<void> {
  if (diagnostics) {
    const script = await readFile(process.env['LEON_DESKTOP_SMOKE_SCRIPT']!, 'utf8')
    target.webContents.on('did-finish-load', () => {
      void target.webContents.executeJavaScript(
        `window.leonDiagnosticConfig = ${JSON.stringify(configuration)};\n${script}`
      ).catch((error) => {
        console.error(error)
        app.exit(1)
      })
    })
  }

}

async function showClient(server: string): Promise<void> {
  if (window && !window.isDestroyed()) {
    restoreWindow()
    return
  }
  await state?.close()
  gateway?.close()
  const clientSession = session.fromPartition('leon-client')
  const backendSession = session.fromPartition('leon-backend')
  state = await createDesktopState({ directory: app.getPath('userData'),
    backend: new URL(server), session: backendSession,
    safeStorage: process.platform === 'darwin' && !manifest.release ? undefined : safeStorage,
    ephemeral: diagnostics || process.env['LEON_DESKTOP_EPHEMERAL'] === '1',
    onColorSchemeChange: updateWindowAppearance })
  gateway = await createGateway({ frontend: bootstrapController ? async (): Promise<string> => await bootstrapController?.frontend() ?? frontend : frontend, backendSession, state,
    backendOrigin: server,
    openOAuthURL: (url) => shell.openExternal(url),
    ...(bootstrapController ? {
      bootstrap: bootstrapAPI(bootstrapController, { openLogs: async (file) => {
        if (file) {
          const error = await shell.openPath(file)
          if (error) {
            throw new Error(error)
          }
        }
      } }),
      bootstrapPhase: (): string => bootstrapController!.store.state.phase
    } : {}),
    notifications: completionNotifications({ diagnostic: diagnostics,
      profile: async () => {
        const operation = requestBackend({ session: backendSession, url: new URL('/api/v1/profile-auth', server) })
        const auth = await readBackendJSON(await operation.response)
        return auth['authenticated'] && typeof auth['profile_name'] === 'string' ? auth['profile_name'] : null
      },
      show: (value) => {
        if (diagnostics) {
          return true
        }
        if (!Notification.isSupported()) {
          return false
        }
        const notification = new Notification({ title: manifest.productName,
          body: 'I’ve finished my response.', silent: true })
        if (notifications.size >= MAXIMUM_NOTIFICATIONS) {
          const oldest = notifications.values().next().value!
          oldest.close()
          notifications.delete(oldest)
        }
        notifications.add(notification)
        notification.once('close', () => notifications.delete(notification))
        notification.once('failed', () => notifications.delete(notification))
        notification.once('click', () => {
          if (restoreWindow()) {
            void window!.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent(${JSON.stringify(DESKTOP_NOTIFICATION_EVENT)}, {detail:${JSON.stringify(value)}}))`).catch(console.error)
          }
        })
        notification.show()
        return true
      }
    }),
    desktopUpdates: desktopUpdatesAPI(desktopUpdater, async (): Promise<import('../../../bridges/runtime/contracts/updates').UpdateState | null> => await bootstrapController?.updateState() ?? null),
    reportPath: diagnostics ? process.env['LEON_DESKTOP_REPORT_PATH'] : undefined,
    onDiagnosticWindow: diagnostics ? (action): object => {
      if (action === 'close') {
        window?.close()
      } else if (action === 'activate') {
        app.emit('activate')
      } else if (action === 'quit') {
        setImmediate(() => app.quit())
      } else if (action === 'resize' && configuration.window_bounds) {
        window?.setBounds(configuration.window_bounds)
      } else if (action === 'hide' || action === 'hide-popup') {
        const target = action === 'hide-popup' ? BrowserWindow.getAllWindows().find((current) => current !== window) : window
        Menu.getApplicationMenu()?.getMenuItemById(HIDE_WINDOW_MENU_ID)?.click({}, target, target?.webContents)
      }
      const alive = Boolean(window && !window.isDestroyed())
      return { alive, visible: alive && window!.isVisible(), focused: alive && window!.isFocused(), platform: process.platform,
        minimized: alive && window!.isMinimized(),
        background: alive ? window!.getBackgroundColor() : null,
        bounds: alive ? window!.getBounds() : null,
        systemDark: nativeTheme.shouldUseDarkColors }
    } : undefined,
    onDiagnosticPaste: diagnostics ? (): Promise<void> => pasteAttachments(window, gateway, { diagnostic: true,
      paths: configuration.clipboard_files ?? [] }) : undefined })
  window = createWindow(clientSession)
  installPasteMenu(window, (): Promise<void> => pasteAttachments(window, gateway))
  configureNavigation(window, { origin: gateway.origin, clientSession, background })
  configurePermissions(clientSession, window, gateway.origin)

  await installDiagnosticScript(window)

  try {
    await loadClientURL(window, gateway.entry)
  } catch (error) {
    if (!quitRequested && !quitting) {
      throw error
    }
  }
}

function installCoreMenu(): void {
  if (!bootstrapController) {
    return
  }
  const menu = Menu.getApplicationMenu() ?? new Menu()
  const run = (action: () => Promise<void>): void => {
    void action().catch((error) => {
      if (window && !diagnostics) {
        void dialog.showMessageBox(window, { type: 'error', message: error.message })
      }
    })
  }
  const start = new MenuItem({ label: 'Start Core',
    click: (): void => run(() => bootstrapController!.start()) })
  const startup = new MenuItem({ label: 'Start Core when I sign in', type: 'checkbox',
    click: (item): void => run(() => bootstrapController!.setStartup(item.checked)) })
  const logs = new MenuItem({ label: 'Open Core logs', click: (): void => run(async () => {
    const error = await shell.openPath(bootstrapController!.log!)
    if (error) {
      throw new Error(error)
    }
  }) })
  const stop = new MenuItem({ label: 'Stop Core', click: (): void => run(() => bootstrapController!.stop()) })
  const submenu = new Menu()
  for (const item of [start, startup, logs, stop]) {
    submenu.append(item)
  }
  menu.append(new MenuItem({ label: 'Core', submenu }))
  const update = (): void => {
    const data = bootstrapController!.store.state
    const managed = data.phase === 'complete' && !data.external
    start.enabled = data.phase !== 'running' && data.phase !== 'complete'
    startup.enabled = managed
    startup.checked = data.service
    logs.enabled = Boolean(bootstrapController!.log)
    stop.enabled = managed
  }
  bootstrapController.store.events.on('change', update)
  update()
  Menu.setApplicationMenu(menu)
}

async function start(): Promise<void> {
  const updateAppearance = (): void => {
    if (quitRequested || quitting) {
      return
    }
    const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
    if (process.platform === 'darwin' && !background && !manifest.nativeMacIcon) {
      // Raster fallback builds lack the system's light/dark asset catalog.
      app.dock?.setIcon(path.join(icons, `${theme}.png`))
    }
    // Keep Dock appearance tied to macOS, independently of Leon's saved theme.
    updateWindowAppearance()
  }
  updateAppearance()
  nativeTheme.on('updated', updateAppearance)
  configuration = diagnostics
    ? JSON.parse(await readFile(process.env['LEON_DESKTOP_DIAGNOSTIC_CONFIG']!, 'utf8'))
    : {}
  let engine
  const updateConfig = path.join(process.resourcesPath, 'app-update.yml')
  const { access } = await import('node:fs/promises')
  if (!diagnostics && manifest.desktopUpdates && await access(updateConfig).then(() => true).catch(() => false)) {
    const updater = await import('../runtime/desktop-updater.mjs')
    engine = updater.default.autoUpdater
  }
  desktopUpdater = createDesktopUpdater({ engine, currentVersion: app.getVersion(),
    reason: engine ? null : 'Automatic desktop updates are unavailable for this installation.',
    beforeInstall: async () => {
      if (bootstrapController?.store.state.phase === 'running') {
        throw new Error('Let me finish Core setup before restarting the desktop app.')
      }
      await Promise.all([state?.close(), bootstrapController?.close()])
      quitting = true
      desktopUpdater.close()
      gateway?.close()
    } })
  desktopUpdater.start()
  const { createBootstrap, profileOrigin } = await import('./bootstrap.js')
  const dependencies = diagnostics && configuration.bootstrap
    ? (await import('../test/bootstrap-fixture.mjs')).bootstrapFixture(configuration.bootstrap) : {}
  const origin = diagnostics && configuration.bootstrap ? undefined : process.env['LEON_DESKTOP_SERVER']
  bootstrapController = await createBootstrap({ dependencies, origin })
  // The shared root opens while preparation advances; it never asks owners to
  // choose an installation. Authentication starts only after Core is ready.
  void bootstrapController.start()
  await showClient(origin ?? await profileOrigin())
  installCoreMenu()
}

if (ownsInstance) {
  void app.whenReady().then(start).catch(failStartup)
}
