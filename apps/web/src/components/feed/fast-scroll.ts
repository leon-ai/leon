import { elementScroll, type VirtualizerOptions } from '@tanstack/react-virtual'

const SCROLL_DURATION_MS = 240
const EASE_OUT_POWER = 3

interface FastScrollDriver {
  scrollToFn: VirtualizerOptions<HTMLElement, Element>['scrollToFn']
  cancel: () => void
}

/**
 * Bounds smooth scrolling while TanStack retains destination reconciliation.
 * Only an active scroll owns a frame and input listeners; no React state is used.
 */
export function createFastScrollDriver(): FastScrollDriver {
  let active: { target: number, cancel: () => void } | null = null
  const cancel = (): void => {
    active?.cancel()
  }
  const scrollToFn: FastScrollDriver['scrollToFn'] = (offset, options, instance) => {
    if (active && options.behavior !== undefined) {
      // Measured rows or streamed content can move the end. Retarget the same
      // animation without restarting its deadline or snapping its final approach.
      active.target = offset + (options.adjustments ?? 0)
      return
    }

    const element = instance.scrollElement
    const view = element?.ownerDocument.defaultView
    if (options.behavior !== 'smooth' || !element || !view) {
      elementScroll(offset, options, instance)
      return
    }

    const events = new AbortController()
    const startedAt = view.performance.now()
    let remainingMs = SCROLL_DURATION_MS
    let frame = 0
    const finish = (): void => {
      view.cancelAnimationFrame(frame)
      events.abort()
      active = null
    }
    const interrupt = (): void => {
      finish()
      instance.cancelScroll()
    }
    const animation = { target: offset + (options.adjustments ?? 0), cancel: interrupt }
    active = animation

    const animate = (now: number): void => {
      if (!element.isConnected || element.ownerDocument.hidden) {
        interrupt()
        return
      }

      const nextRemainingMs = Math.max(0, Math.min(remainingMs, SCROLL_DURATION_MS - (now - startedAt)))
      const fraction = 1 - (nextRemainingMs / remainingMs) ** EASE_OUT_POWER
      remainingMs = nextRemainingMs

      // Ease from the current position so changing virtual measurements cannot
      // pull the viewport backward toward an obsolete interpolated position.
      const current = element.scrollTop
      elementScroll(
        current + (animation.target - current) * fraction,
        { behavior: 'instant' },
        instance
      )

      if (remainingMs === 0) {
        finish()
      } else {
        frame = view.requestAnimationFrame(animate)
      }
    }

    const inputOptions = { passive: true, signal: events.signal }
    element.addEventListener('wheel', interrupt, inputOptions)
    element.addEventListener('touchstart', interrupt, inputOptions)
    element.addEventListener('pointerdown', interrupt, inputOptions)
    element.addEventListener('keydown', interrupt, inputOptions)
    element.ownerDocument.addEventListener('visibilitychange', () => {
      if (element.ownerDocument.hidden) {
        interrupt()
      }
    }, { signal: events.signal })
    frame = view.requestAnimationFrame(animate)
  }

  return { scrollToFn, cancel }
}
