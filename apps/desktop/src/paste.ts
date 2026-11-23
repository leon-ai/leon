import { BrowserWindow, clipboard, Menu } from 'electron'
import { fileURLToPath } from 'node:url'

import contract from '../runtime/desktop-contract.mjs'
import type { createGateway } from './gateway.js'
import type { FileGrants } from './types.js'

const MAXIMUM_URI_LIST_BYTES = 65_536

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
 * Shares one Paste action between the native menu, keyboard shortcut and context
 * menu. No global shortcut or clipboard observer runs while the app is idle.
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
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, pasteItem, { type: 'separator' }, { role: 'selectAll' }] },
    { role: 'windowMenu' }
  ]))
  window.webContents.on('context-menu', (_event, parameters) => {
    if (parameters.isEditable) {
      Menu.buildFromTemplate([{ role: 'cut' }, { role: 'copy' }, pasteItem,
        { role: 'selectAll' }]).popup({ window })
    }
  })
}
