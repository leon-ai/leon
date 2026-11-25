import { dialog, shell, type BrowserWindow, type Session } from 'electron'

const MAIN_FRAME_PERMISSIONS = new Set([
  'clipboard-sanitized-write',
  'clipboard-write',
  'fullscreen'
])

/**
 * Opens explicit ordinary links in the system browser, keeping executable and
 * filesystem URL schemes outside the desktop navigation surface.
 */
export function isExternalURL(value: string): boolean {
  try {
    const url = new URL(value)
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}

/**
 * Keeps provider authorization in an isolated popup that can return to Leon's
 * BroadcastChannel callback. It receives no native capability or Node bridge.
 */
export function configureNavigation(window: BrowserWindow, { origin, clientSession, background = false }: {
  origin: string
  clientSession: Session
  background?: boolean
}): void {
  window.webContents.setWindowOpenHandler((details) => {
    let target: URL
    try {
      target = new URL(details.url)
    } catch {
      return { action: 'deny' }
    }
    const localArtifact = target.origin === origin && target.pathname.startsWith('/api/v1/artifacts/')
    if (localArtifact || details.url === 'about:blank' && details.features.includes('popup')) {
      return { action: 'allow', overrideBrowserWindowOptions: {
        width: 560, height: 720, show: !background, focusable: !background,
        paintWhenInitiallyHidden: !background,
        webPreferences: { session: clientSession, nodeIntegration: false,
          contextIsolation: true, sandbox: true, webSecurity: true,
          webviewTag: false, backgroundThrottling: true }
      } }
    }
    if (target.origin === origin && target.pathname.startsWith('/web-app/')) {
      void window.loadURL(details.url).catch(console.error)
      return { action: 'deny' }
    }
    if (!background && isExternalURL(details.url)) {
      void shell.openExternal(details.url).catch(console.error)
    }
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, value) => {
    try {
      const target = new URL(value)
      if (target.origin === origin && target.pathname.startsWith('/web-app/')) {
        return
      }
    } catch {
      // Malformed destinations must not escape a navigation event handler.
    }
    event.preventDefault()
    if (!background && isExternalURL(value) && new URL(value).origin !== origin) {
      void shell.openExternal(value).catch(console.error)
    }
  })
  window.webContents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame) {
      try {
        const target = new URL(event.url)
        if (target.protocol === 'blob:' && target.origin === origin) {
          return
        }
      } catch {
        // Generated frames may navigate only within their isolated Blob content.
      }
      event.preventDefault()
    }
  })
  window.webContents.on('did-create-window', (popup) => {
    popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    popup.webContents.on('will-navigate', (event, value) => {
      if (value !== 'about:blank' && (!isExternalURL(value) || new URL(value).protocol === 'mailto:')) {
        event.preventDefault()
      }
    })
  })
}

/**
 * Lets the active main document write to the clipboard and enter fullscreen
 * after user interaction. Camera and microphone access require owner consent.
 * Opaque Aurora frames and provider windows cannot inherit these grants.
 */
export function configurePermissions(clientSession: Session, window: BrowserWindow, origin: string): void {
  const media = new Set<string>()
  const trusted = (contents: Electron.WebContents | null, requesting: string): boolean => {
    try {
      return contents === window.webContents && !window.isDestroyed() && window.isFocused() &&
        new URL(requesting).origin === origin
    } catch {
      return false
    }
  }
  clientSession.setPermissionCheckHandler((contents, permission, requesting, details) => {
    if (!trusted(contents, requesting) || details.isMainFrame === false) {
      return false
    }
    return MAIN_FRAME_PERMISSIONS.has(permission) ||
      permission === 'media' && media.has(details.mediaType ?? '')
  })
  clientSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (!trusted(contents, details.requestingUrl) || details.isMainFrame === false) {
      callback(false)
      return
    }
    if (MAIN_FRAME_PERMISSIONS.has(permission)) {
      callback(true)
      return
    }
    if (permission !== 'media' || !('mediaTypes' in details) || !details.mediaTypes?.length) {
      callback(false)
      return
    }
    const requested = details.mediaTypes.filter((kind) => ['audio', 'video'].includes(kind))
    if (requested.length !== details.mediaTypes.length) {
      callback(false)
      return
    }
    void dialog.showMessageBox(window, { type: 'question', buttons: ['Allow', 'Don’t allow'],
      defaultId: 1, cancelId: 1, title: 'Leon',
      message: `May I use your ${requested.includes('video') ? 'camera' : 'microphone'}?` })
      .then(({ response }) => {
        const allowed = response === 0 && trusted(contents, details.requestingUrl)
        if (allowed) {
          requested.forEach((kind) => media.add(kind))
        }
        callback(allowed)
      }).catch(() => callback(false))
  })
}
