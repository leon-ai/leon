const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const subscribers = new Set<() => void>()
const targets = new Map<Element, { visible: boolean, update: (running: boolean) => void }>()
let preference: MediaQueryList | undefined
let observer: IntersectionObserver | undefined

/**
 * Visible windows can show motion while another window has focus.
 */
export function getAnimationVisibility(): boolean {
  return !document.hidden &&
    !(preference ?? window.matchMedia(REDUCED_MOTION_QUERY)).matches
}

function update(): void {
  for (const subscriber of subscribers) {
    subscriber()
  }
}

/**
 * Attaches one set of document listeners, releasing it with the last subscriber.
 */
export function subscribeAnimationVisibility(subscriber: () => void): () => void {
  if (subscribers.size === 0) {
    preference = window.matchMedia(REDUCED_MOTION_QUERY)
    preference.addEventListener('change', update)
    document.addEventListener('visibilitychange', update)
  }

  subscribers.add(subscriber)

  return () => {
    subscribers.delete(subscriber)
    if (subscribers.size === 0) {
      preference?.removeEventListener('change', update)
      document.removeEventListener('visibilitychange', update)
      preference = undefined
    }
  }
}

/**
 * Gates an effect through shared document and viewport observers without frames
 * or React renders. Unobserved elements start paused until their first delivery.
 */
export function observeAnimationVisibility(
  element: Element,
  onChange: (running: boolean) => void
): () => void {
  let previous: boolean | undefined
  const target = {
    visible: false,
    update(running: boolean): void {
      if (running !== previous) {
        previous = running
        onChange(running)
      }
    }
  }
  const refresh = (): void => target.update(target.visible && getAnimationVisibility())
  const unsubscribe = subscribeAnimationVisibility(refresh)

  if (observer === undefined) {
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const observed = targets.get(entry.target)

        if (observed !== undefined) {
          observed.visible = entry.isIntersecting
          observed.update(observed.visible && getAnimationVisibility())
        }
      }
    })
  }

  targets.set(element, target)
  refresh()
  observer.observe(element)

  return () => {
    unsubscribe()
    targets.delete(element)
    observer?.unobserve(element)
    target.update(false)
    if (targets.size === 0) {
      observer?.disconnect()
      observer = undefined
    }
  }
}
