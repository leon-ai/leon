import { useEffect, useRef, useState, type RefObject } from 'react'

const PRELOAD_MARGIN = '200px'

/**
 * Defers optional media work until a mounted element approaches the viewport.
 * Observation ends after first visibility and is released on unmount.
 */
export function useNearViewport<T extends HTMLElement>(): { ref: RefObject<T | null>, visible: boolean } {
  const ref = useRef<T>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!ref.current) {
      return undefined
    }
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return undefined
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: PRELOAD_MARGIN })
    observer.observe(ref.current)

    return (): void => observer.disconnect()
  }, [])

  return { ref, visible }
}
