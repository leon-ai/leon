import { useEffect, useState } from 'react'

import {
  getCurrentTheme,
  THEME_CHANGE_EVENT,
  type Theme
} from '@/theme'

/**
 * Keeps React consumers synchronized with theme changes from any UI surface.
 */
export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(getCurrentTheme)

  useEffect(() => {
    function handleThemeChange(event: Event): void {
      setTheme((event as CustomEvent<Theme>).detail)
    }

    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange)

    return (): void => {
      window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange)
    }
  }, [])

  return theme
}
