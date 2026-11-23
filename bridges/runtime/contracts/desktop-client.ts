/**
 * File references granted by an explicit native Paste action. The host keeps
 * filesystem paths private and serves each reference only to its own client.
 */
export interface DesktopAttachmentFile {
  kind: 'desktop-file'
  id: string
  name: string
  size: number
  url: string
}

export const DESKTOP_FILES_EVENT = 'leon:desktop-files'
export const DESKTOP_FILES_PATH = '/__desktop/files/'
export const DESKTOP_UPLOAD_EVENT_MAX_CHARACTERS = 65_536

export enum WebPreferenceKey {
  Theme = 'leon.web-app.theme',
  Accent = 'leon.web-app.accent',
  SidebarExpanded = 'leon.web-app.sidebar-expanded',
  SoundsEnabled = 'leon.web-app.sounds-enabled',
  RecentModels = 'leon.web-app.recent-models'
}

export interface DesktopFilesEvent {
  files: DesktopAttachmentFile[]
  issues?: string[]
}

export const DESKTOP_UPDATES_PATH = '/__desktop/updates/'

export const DESKTOP_UPDATES_META_NAME = 'leon-desktop-updates'

export { DESKTOP_CORE_PROTOCOL_VERSION } from './distribution.js'
export const DESKTOP_BOOTSTRAP_META_NAME = 'leon-desktop-bootstrap'
export const DESKTOP_BOOTSTRAP_PATH = '/__desktop/bootstrap/'
export const DESKTOP_NOTIFICATION_PATH = '/__desktop/notifications'
export const DESKTOP_NOTIFICATION_EVENT = 'leon:desktop-notification'

/**
 * Native notifications identify a completed turn without exposing its content.
 */
export interface DesktopTurnNotification {
  profile: string
  sessionId: string
  sequence: number
}
