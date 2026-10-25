import { flushSync } from 'react-dom'

const DEFAULT_THEME = 'dark'
const DEFAULT_SIDEBAR_EXPANDED = true
const DEFAULT_SOUNDS_ENABLED = true
const SIDEBAR_EXPANDED_STORAGE_KEY = 'leon.web-app.sidebar-expanded'
const SOUNDS_ENABLED_STORAGE_KEY = 'leon.web-app.sounds-enabled'
const THEME_STORAGE_KEY = 'leon.web-app.theme'
const THEMES = ['dark', 'light'] as const
const REDUCED_MOTION_MEDIA_QUERY = '(prefers-reduced-motion: reduce)'
const THEME_TRANSITION_ATTRIBUTE = 'data-theme-transition'

export const THEME_CHANGE_EVENT = 'leon:web-app-theme-change'

export type Theme = (typeof THEMES)[number]

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

function saveBoolean(key: string, value: boolean): void {
  window.localStorage.setItem(key, String(value))
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

      if (activeThemeTransition === null) {
        root.removeAttribute(THEME_TRANSITION_ATTRIBUTE)
      }
    }
  }
}

export function getStoredTheme(): Theme {
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)

  return isTheme(storedTheme) ? storedTheme : DEFAULT_THEME
}

/**
 * Returns the rendered theme, including temporary preview selections.
 */
export function getCurrentTheme(): Theme {
  const theme = document.documentElement.dataset['theme'] ?? null

  return isTheme(theme) ? theme : getStoredTheme()
}

/**
 * Applies the saved palette before React paints the initial view.
 */
export function applyStoredTheme(): void {
  commitTheme(getStoredTheme())
}

/**
 * Persists a selected theme once its visual update has been applied.
 */
export function saveTheme(theme: Theme): void {
  void applyTheme(theme).then((applied) => {
    if (applied) {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    }
  })
}

/**
 * Toggles the latest requested theme, including one still being prepared.
 */
export function toggleTheme(): void {
  const theme = requestedTheme ?? getCurrentTheme()

  saveTheme(theme === 'dark' ? 'light' : 'dark')
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
