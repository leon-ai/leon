import { BrowserWindow, clipboard, Menu } from 'electron'
import { fileURLToPath } from 'node:url'

import contract from '../runtime/desktop-contract.mjs'
import type { createGateway } from './gateway.js'
import type { FileGrants } from './types.js'

const MAXIMUM_URI_LIST_BYTES = 65_536
export const HIDE_WINDOW_MENU_ID = 'hide-window'

/**
 * Reads native file references only when Paste is explicitly invoked. Electron
 * maps this MIME type to Finder, Explorer and Linux file-manager formats.
 */
async function copiedFiles(): Promise<string[]> {
  const items = await clipboard.read()
  for (const item of items) {
    if (item.types.includes('text/uri-list')) {
      const data = await item.getType('text/uri-list')
      if (data.size > MAXIMUM_URI_LIST_BYTES) {
        throw new Error('I can’t read this selection. Please copy fewer files.')
      }
      const files = []
      for (const line of (await data.text()).split('\n')) {
        const value = line.trim()
        if (!value || value.startsWith('#')) {
          continue
        }
        const url = new URL(value)
        if (url.protocol === 'file:') {
          files.push(fileURLToPath(url))
        }
        if (files.length > contract.maximumFiles) {
          break
        }
      }
      return files
    }
  }
  return []
}

/**
 * Delivers metadata to the active session page. Text and image clipboard data
 * retain the WebView's native paste behaviour, including its undo history.
 */
export async function pasteAttachments(window: BrowserWindow | undefined,
  gateway: Awaited<ReturnType<typeof createGateway>> | undefined,
  { diagnostic = false, paths }: { diagnostic?: boolean, paths?: string[] } = {}): Promise<void> {
  if (!window || !gateway || window.isDestroyed() || !diagnostic && !window.isFocused()) {
    return
  }
  const address = window.webContents.getURL()
  const url = new URL(address)
  if (url.origin !== gateway.origin ||
    url.pathname !== '/web-app/' && !url.pathname.startsWith('/web-app/session/')) {
    window.webContents.paste()
    return
  }
  let result: FileGrants
  try {
    const selected = paths ?? await copiedFiles()
    if (window.isDestroyed() || window.webContents.getURL() !== address) {
      return
    }
    if (!selected.length) {
      window.webContents.paste()
      return
    }
    result = await gateway.grantFiles(selected)
  } catch (error) {
    result = { files: [], issues: [error instanceof Error ? error.message : String(error)] }
  }
  if (!window.isDestroyed() && window.webContents.getURL() === address) {
    await window.webContents.executeJavaScript(
      `window.dispatchEvent(new CustomEvent(${JSON.stringify(contract.filesEvent)}, { detail: ${JSON.stringify(result)} }))`, true)
  }
}

/**
 * Owns app-local window, view and editing actions. Paste shares its native menu,
 * shortcut and context action without an idle clipboard observer or global keys.
 */
export function installPasteMenu(window: BrowserWindow, paste: () => Promise<void>): void {
  const pasteItem = { label: 'Paste', accelerator: 'CmdOrCtrl+V', click: (): void => {
    const focused = BrowserWindow.getFocusedWindow()
    if (focused && focused !== window) {
      focused.webContents.paste()
    } else {
      void paste()
    }
  } }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { label: 'File', submenu: [
      { id: HIDE_WINDOW_MENU_ID, label: process.platform === 'darwin' ? 'Hide window' : 'Minimize window',
        accelerator: 'CmdOrCtrl+W', click: (_item, focused): void => {
          const target = focused ?? BrowserWindow.getFocusedWindow() ?? window
          if (target.isDestroyed()) {
            return
          }
          // Account and artifact popups keep their ordinary close behaviour.
          if (target !== window || process.platform === 'darwin') {
            target.close()
          } else {
            target.minimize()
          }
        } },
      ...(process.platform === 'darwin' ? [] : [{ type: 'separator' as const }, { role: 'quit' as const }])
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, pasteItem, { type: 'separator' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
      { type: 'separator' }, { role: 'togglefullscreen' }] },
    // Avoid the default Windows/Linux Close accelerator competing with Cmd/Ctrl+W.
    { role: 'windowMenu', submenu: [{ role: 'minimize' },
      ...(process.platform === 'darwin' ? [{ role: 'zoom' as const }, { type: 'separator' as const },
        { role: 'front' as const }, { role: 'window' as const }] : [])] }
  ]))
  window.webContents.on('context-menu', (_event, parameters) => {
    if (parameters.isEditable) {
      Menu.buildFromTemplate([{ role: 'cut' }, { role: 'copy' }, pasteItem,
        { role: 'selectAll' }]).popup({ window })
    }
  })
}
