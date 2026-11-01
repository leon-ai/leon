import type { KeyboardEvent } from 'react'

interface ListNavigationOptions {
  count: number
  currentIndex: number
  isSelectable?: (index: number) => boolean
  loop?: boolean
  horizontal?: boolean
}

/**
 * Resolves list movement without owning focus, selection or scrolling. Text
 * fields keep Home/End editing; composition and modified shortcuts stay native.
 * Undefined means unhandled, while -1 means a handled key in an empty list.
 */
export function getListNavigationIndex(
  event: KeyboardEvent<HTMLElement>,
  { count, currentIndex, isSelectable, loop = false, horizontal = false }: ListNavigationOptions
): number | undefined {
  if (event.defaultPrevented || event.nativeEvent.isComposing ||
    event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return undefined
  }

  const boundary = event.key === 'Home' || event.key === 'End'
  if (boundary && event.target instanceof HTMLElement &&
    (event.target.matches('input, textarea') || event.target.isContentEditable)) {
    return undefined
  }
  const forward = event.key === 'ArrowDown' || horizontal && event.key === 'ArrowRight'
  const backward = event.key === 'ArrowUp' || horizontal && event.key === 'ArrowLeft'
  if (!boundary && !forward && !backward) {
    return undefined
  }
  if (count === 0) {
    return -1
  }

  const direction = event.key === 'End' || backward ? -1 : 1
  let next = boundary || currentIndex < 0
    ? direction > 0 ? 0 : count - 1
    : currentIndex + direction
  for (let visited = 0; visited < count; visited++) {
    if (next < 0 || next >= count) {
      if (!loop || boundary) {
        return currentIndex
      }
      next = (next + count) % count
    }
    if (isSelectable?.(next) !== false) {
      return next
    }
    next += direction
  }

  return -1
}
