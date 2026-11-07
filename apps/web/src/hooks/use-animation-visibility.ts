import { useEffect, useState } from 'react'

const REDUCED_MOTION_MEDIA_QUERY = '(prefers-reduced-motion: reduce)'

/**
 * Allows decorative animation only while the document is visible and motion is wanted.
 */
export function useAnimationVisibility(): boolean {
  const [canAnimate, setCanAnimate] = useState(() =>
    !document.hidden && !window.matchMedia(REDUCED_MOTION_MEDIA_QUERY).matches
  )

  useEffect(() => {
    const preference = window.matchMedia(REDUCED_MOTION_MEDIA_QUERY)

    function update(): void {
      setCanAnimate(!document.hidden && !preference.matches)
    }

    document.addEventListener('visibilitychange', update)
    preference.addEventListener('change', update)
    update()

    return (): void => {
      document.removeEventListener('visibilitychange', update)
      preference.removeEventListener('change', update)
    }
  }, [])

  return canAnimate
}
