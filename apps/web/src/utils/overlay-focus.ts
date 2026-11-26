let restoringFocusTo: HTMLElement | undefined

/**
 * Returns focus to an overlay's opener without triggering its tooltip.
 */
export function restoreOverlayFocus(element: HTMLElement | null | undefined): void {
  if (!element?.isConnected) {
    return
  }

  const previous = restoringFocusTo
  restoringFocusTo = element
  try {
    element.focus({ preventScroll: true })
  } finally {
    restoringFocusTo = previous
  }
}

/**
 * Identifies focus events caused by overlay dismissal.
 */
export function isRestoringOverlayFocus(target: EventTarget): boolean {
  return target === restoringFocusTo
}
