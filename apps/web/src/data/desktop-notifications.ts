import { DESKTOP_NOTIFICATION_PATH, type DesktopTurnNotification } from '../../../../bridges/runtime/contracts/desktop-client'

/**
 * Shares the live completion trigger with sound without tying native delivery to
 * audio permission or previews. The native host owns authentication and receipts.
 */
export function notifyDesktopTurnCompleted(value: DesktopTurnNotification): void {
  if (!document.querySelector('meta[name="leon-desktop"]')) {
    return
  }
  void fetch(DESKTOP_NOTIFICATION_PATH, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value)
  }).catch(() => {
    // Notification delivery must never interrupt the conversation stream.
  })
}
