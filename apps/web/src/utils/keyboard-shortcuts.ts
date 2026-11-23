const MACOS_PLATFORM_KEYWORD = 'mac'
const platform = (navigator as Navigator & { userAgentData?: { platform: string } }).userAgentData?.platform ?? navigator.platform
const macOS = platform.toLowerCase().includes(MACOS_PLATFORM_KEYWORD)

export enum AppShortcutKey {
  NewSession = 'o',
  SearchSessions = 'k',
  Settings = ','
}

export const APP_MODIFIER_LABEL = macOS ? { iconName: 'command', label: 'Command' } : 'Ctrl'
export const NEW_SESSION_REQUIRES_SHIFT = !document.querySelector('meta[name="leon-desktop"]')

/**
 * Leaves the other platform modifier available for native editing and OS actions.
 */
export function hasAppModifier(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey'>): boolean {
  return macOS ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
}

/**
 * Shares accessible shortcut labels with the platform-specific keyboard handler.
 */
export function getAppShortcutAria(key: AppShortcutKey, shift = false): string {
  return [macOS ? 'Meta' : 'Control', ...(shift ? ['Shift'] : []), key.toUpperCase()].join('+')
}
