const currentStatuses = {}
const listeners = new Set()

/** Return the latest initialization statuses without exposing mutable state. */
export function getInitStatuses() {
  return { ...currentStatuses }
}

/** Store an initialization status and notify every mounted listener. */
export function setInitStatus(statusName, statusType) {
  currentStatuses[statusName] = statusType
  const statuses = getInitStatuses()

  for (const listener of listeners) {
    listener(statuses)
  }
}

/** Subscribe to status changes and immediately reconcile earlier updates. */
export function subscribeInitStatuses(listener) {
  listeners.add(listener)
  listener(getInitStatuses())

  return () => {
    listeners.delete(listener)
  }
}
