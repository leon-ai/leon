import { flushSync } from 'react-dom'
import { WebPreferenceKey, saveWebPreference } from '@/utils/web-preferences'
import { ACCENT_COLORS, type AccentColor } from '../../../bridges/runtime/contracts/workspace'
import { DEFAULT_WEB_THEME, WEB_THEMES, type WebColorScheme, type WebTheme } from '../../../bridges/runtime/contracts/desktop-client'

const DEFAULT_THEME = DEFAULT_WEB_THEME
const DEFAULT_SIDEBAR_EXPANDED = true
const DEFAULT_SOUNDS_ENABLED = true
const THEMES = WEB_THEMES
const REDUCED_MOTION_MEDIA_QUERY = '(prefers-reduced-motion: reduce)'
const SYSTEM_DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)'
export const THEME_TRANSITION_ATTRIBUTE = 'data-theme-transition'

export const THEME_CHANGE_EVENT = 'leon:web-app-theme-change'
export const THEME_REQUEST_EVENT = 'leon:web-app-theme-request'

export type Theme = WebTheme
export type ColorScheme = WebColorScheme

type ThemePreparation = (theme: Theme) => Promise<(() => void) | void>

interface PreparedThemeUpdate {
  prepare: ThemePreparation
  update: (() => void) | void
}

const themePreparations = new Set<ThemePreparation>()
let themeRequest = 0
let requestedTheme: Theme | null = null
let activeThemeTransition: ViewTransition | null = null

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

function saveBoolean(key: WebPreferenceKey, value: boolean): void {
  saveWebPreference(key, String(value))
}

/**
 * Commits the palette and prepared React updates in the same rendered frame.
 */
function commitTheme(
  theme: Theme,
  preparedUpdates: PreparedThemeUpdate[] = []
): void {
  flushSync(() => {
    document.documentElement.dataset['theme'] = theme

    for (const { prepare, update } of preparedUpdates) {
      if (themePreparations.has(prepare)) {
        update?.()
      }
    }

    window.dispatchEvent(new CustomEvent<Theme>(THEME_CHANGE_EVENT, {
      detail: theme
    }))
  })

  // Resolve the final styles while individual property transitions are disabled.
  document.documentElement.getBoundingClientRect()
}

/**
 * Registers resources and optional visual updates required before a theme switch.
 */
export function registerThemePreparation(prepare: ThemePreparation): () => void {
  themePreparations.add(prepare)

  return () => {
    themePreparations.delete(prepare)
  }
}

/**
 * Switches complete theme compositions together, retaining the latest request.
 */
export async function applyTheme(theme: Theme): Promise<boolean> {
  const root = document.documentElement
  const request = ++themeRequest

  requestedTheme = theme
  window.dispatchEvent(new CustomEvent<Theme>(THEME_REQUEST_EVENT, { detail: theme }))
  activeThemeTransition?.skipTransition()
  activeThemeTransition = null
  root.removeAttribute(THEME_TRANSITION_ATTRIBUTE)

  try {
    if (root.dataset['theme'] === theme) {
      return true
    }

    const preparedUpdates = await Promise.all(
      [...themePreparations].map(async (prepare) => ({
        prepare,
        update: await prepare(theme)
      }))
    )

    if (request !== themeRequest) {
      return false
    }

    root.setAttribute(THEME_TRANSITION_ATTRIBUTE, '')

    const update = (): void => {
      if (request === themeRequest) {
        commitTheme(theme, preparedUpdates)
      }
    }

    if (
      !('startViewTransition' in document) ||
      window.matchMedia(REDUCED_MOTION_MEDIA_QUERY).matches
    ) {
      update()
      return true
    }

    let transition: ViewTransition

    try {
      transition = document.startViewTransition(update)
    } catch {
      update()
      return true
    }

    activeThemeTransition = transition

    function finishTransition(): void {
      if (activeThemeTransition === transition) {
        activeThemeTransition = null
        root.removeAttribute(THEME_TRANSITION_ATTRIBUTE)
      }
    }

    void transition.finished.then(finishTransition, finishTransition)
    await transition.updateCallbackDone

    return request === themeRequest && root.dataset['theme'] === theme
  } catch {
    // Only a completed visual update may become the saved preference.
    return false
  } finally {
    if (request === themeRequest) {
      requestedTheme = null
      // Controls follow the requested palette immediately, but must return to
      // the rendered one if preparation fails or a request is cancelled.
      window.dispatchEvent(new CustomEvent<Theme>(THEME_REQUEST_EVENT, { detail: getCurrentTheme() }))

      if (activeThemeTransition === null) {
        root.removeAttribute(THEME_TRANSITION_ATTRIBUTE)
      }
    }
  }
}

export function getStoredColorScheme(): ColorScheme {
  const storedTheme = window.localStorage.getItem(WebPreferenceKey.Theme)

  return storedTheme === 'system' || isTheme(storedTheme) ? storedTheme : DEFAULT_THEME
}

function resolveColorScheme(scheme: ColorScheme): Theme {
  return scheme === 'system' ? window.matchMedia(SYSTEM_DARK_MEDIA_QUERY).matches ? 'dark' : 'light' : scheme
}

export function getStoredTheme(): Theme {
  return resolveColorScheme(getStoredColorScheme())
}

/**
 * Returns the rendered theme, including temporary preview selections.
 */
export function getCurrentTheme(): Theme {
  const theme = document.documentElement.dataset['theme'] ?? null

  return isTheme(theme) ? theme : getStoredTheme()
}

/**
 * Returns the latest requested palette for controls that acknowledge pending work.
 */
export function getRequestedTheme(): Theme {
  return requestedTheme ?? getCurrentTheme()
}

/**
 * Applies the saved palette before React paints the initial view.
 */
export function applyStoredTheme(): void {
  commitTheme(getStoredTheme())
  window.matchMedia(SYSTEM_DARK_MEDIA_QUERY).addEventListener('change', () => {
    if (getStoredColorScheme() === 'system') {
      void applyTheme(getStoredTheme())
    }
  })
}

/**
 * Persists a selected theme once its visual update has been applied.
 */
export function saveTheme(theme: Theme): void {
  void saveColorScheme(theme)
}

/**
 * Stores the preference independently of the palette selected by the system.
 */
export async function saveColorScheme(scheme: ColorScheme): Promise<boolean> {
  const applied = await applyTheme(resolveColorScheme(scheme))
  if (applied) {
    saveWebPreference(WebPreferenceKey.Theme, scheme)
    // The operating system may have changed while the palette was preparing.
    const current = resolveColorScheme(scheme)
    if (current !== getCurrentTheme()) {
      void applyTheme(current)
    }
  }
  return applied
}

/**
 * Toggles the latest requested theme, including one still being prepared.
 */
export function toggleTheme(): void {
  const theme = requestedTheme ?? getCurrentTheme()

  saveTheme(theme === 'dark' ? 'light' : 'dark')
}

export function getStoredSoundsEnabled(): boolean {
  return getStoredBoolean(WebPreferenceKey.SoundsEnabled, DEFAULT_SOUNDS_ENABLED)
}

export function saveSoundsEnabled(soundsEnabled: boolean): void {
  saveBoolean(WebPreferenceKey.SoundsEnabled, soundsEnabled)
}

/**
 * Reads only supported palette identities, keeping arbitrary CSS out of storage.
 */
export function getStoredAccent(): AccentColor {
  const value = window.localStorage.getItem(WebPreferenceKey.Accent)

  return ACCENT_COLORS.find((color) => color.id === value)?.id ?? 'blue'
}

/**
 * Applies one shared accent palette to settings and workspace controls.
 */
export function saveAccent(color: AccentColor): void {
  saveWebPreference(WebPreferenceKey.Accent, color)
  document.documentElement.dataset['accent'] = color
}

export function getStoredSidebarExpanded(): boolean {
  return getStoredBoolean(
    WebPreferenceKey.SidebarExpanded,
    DEFAULT_SIDEBAR_EXPANDED
  )
}

export function saveSidebarExpanded(sidebarExpanded: boolean): void {
  saveBoolean(WebPreferenceKey.SidebarExpanded, sidebarExpanded)
}
