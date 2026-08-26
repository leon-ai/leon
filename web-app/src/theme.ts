const DEFAULT_THEME = 'dark'
const DEFAULT_SIDEBAR_EXPANDED = true
const DEFAULT_SOUNDS_ENABLED = true
const SIDEBAR_EXPANDED_STORAGE_KEY = 'leon.web-app.sidebar-expanded'
const SOUNDS_ENABLED_STORAGE_KEY = 'leon.web-app.sounds-enabled'
const THEME_STORAGE_KEY = 'leon.web-app.theme'
const THEMES = ['dark', 'light'] as const

export const THEME_CHANGE_EVENT = 'leon:web-app-theme-change'

export type Theme = (typeof THEMES)[number]

function isTheme(theme: string | null): theme is Theme {
  return THEMES.includes(theme as Theme)
}

function getStoredBoolean(key: string, defaultValue: boolean): boolean {
  const value = window.localStorage.getItem(key)

  if (value === null) {
    return defaultValue
  }

  return value === 'true'
}

function saveBoolean(key: string, value: boolean): void {
  window.localStorage.setItem(key, String(value))
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme
  window.dispatchEvent(new CustomEvent<Theme>(THEME_CHANGE_EVENT, {
    detail: theme
  }))
}

export function getStoredTheme(): Theme {
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)

  return isTheme(storedTheme) ? storedTheme : DEFAULT_THEME
}

export function applyStoredTheme(): void {
  applyTheme(getStoredTheme())
}

export function saveTheme(theme: Theme): void {
  window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  applyTheme(theme)
}

export function getStoredSoundsEnabled(): boolean {
  return getStoredBoolean(SOUNDS_ENABLED_STORAGE_KEY, DEFAULT_SOUNDS_ENABLED)
}

export function saveSoundsEnabled(soundsEnabled: boolean): void {
  saveBoolean(SOUNDS_ENABLED_STORAGE_KEY, soundsEnabled)
}

export function getStoredSidebarExpanded(): boolean {
  return getStoredBoolean(
    SIDEBAR_EXPANDED_STORAGE_KEY,
    DEFAULT_SIDEBAR_EXPANDED
  )
}

export function saveSidebarExpanded(sidebarExpanded: boolean): void {
  saveBoolean(SIDEBAR_EXPANDED_STORAGE_KEY, sidebarExpanded)
}
