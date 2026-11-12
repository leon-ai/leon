import { useLayoutEffect, useRef, type RefObject } from 'react'

const EXIT_TRANSITION_PROPERTY = 'opacity'

/**
 * Releases exiting content after its own opacity transition, without controlling
 * its animation. Missing or cancelled transitions also release the content;
 * reopening invalidates the pending cleanup.
 */
export function useExitCleanup<TElement extends HTMLElement>(
  elementRef: RefObject<TElement | null>,
  exiting: boolean,
  onExited: () => void
): void {
  const onExitedRef = useRef(onExited)

  useLayoutEffect(() => {
    onExitedRef.current = onExited
  }, [onExited])

  useLayoutEffect(() => {
    const element = elementRef.current

    if (!exiting || element === null) {
      return undefined
    }

    // Inspect only the owner's transition: descendants must not shorten its
    // exit, and invisible stacked items may have no opacity change at all.
    const transitions = element.getAnimations().filter((animation) =>
      'transitionProperty' in animation &&
      animation.transitionProperty === EXIT_TRANSITION_PROPERTY
    )

    if (transitions.length === 0) {
      onExitedRef.current()
      return undefined
    }

    let cancelled = false

    // CSS remains the timing source. Reduced motion or interrupted styles can
    // cancel a transition, which must still complete the resource cleanup.
    void Promise.allSettled(transitions.map((animation) => animation.finished))
      .then(() => {
        if (!cancelled) {
          onExitedRef.current()
        }
      })

    return (): void => {
      cancelled = true
    }
  }, [elementRef, exiting])
}
