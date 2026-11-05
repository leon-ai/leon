import { useEffect, useState } from 'react'

import {
  getCurrentTheme,
  getRequestedTheme,
  THEME_CHANGE_EVENT,
  THEME_REQUEST_EVENT,
  type Theme
} from '@/theme'

/**
 * Keeps React consumers synchronized with theme changes from any UI surface.
 */
export function useTheme({ includeRequested = false }: { includeRequested?: boolean } = {}): Theme {
  const [theme, setTheme] = useState<Theme>(includeRequested ? getRequestedTheme : getCurrentTheme)

  useEffect(() => {
    function handleThemeChange(event: Event): void {
      setTheme((event as CustomEvent<Theme>).detail)
    }

    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange)
    if (includeRequested) {
      window.addEventListener(THEME_REQUEST_EVENT, handleThemeChange)
    }

    return (): void => {
      window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange)
      window.removeEventListener(THEME_REQUEST_EVENT, handleThemeChange)
    }
  }, [includeRequested])

  return theme
}
