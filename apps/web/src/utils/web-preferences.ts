import { DESKTOP_META_NAME, WebPreferenceKey } from '../../../../bridges/runtime/contracts/desktop-client'

export { WebPreferenceKey }

type WebPreferenceStorageKey = WebPreferenceKey | `${WebPreferenceKey.RecentModels}.${string}`

const pending = new Map<WebPreferenceStorageKey, string>()
let saving = false

async function flush(): Promise<void> {
  if (saving) {
    return
  }
  saving = true
  try {
    while (pending.size) {
      const values = Object.fromEntries(pending)
      pending.clear()
      await fetch('/__desktop/preferences', {
        method: 'POST', credentials: 'include', keepalive: true,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values)
      })
    }
  } catch {
    // Local preferences remain available to the current page if the desktop
    // host is shutting down. Never retain or persist conversation credentials.
    pending.clear()
  } finally {
    saving = false
  }
}

/**
 * Stores ordinary browser preferences immediately. Desktop hosts additionally
 * retain this small allowlisted state independently of their loopback port.
 */
export function saveWebPreference(key: WebPreferenceStorageKey, value: string): void {
  if (window.localStorage.getItem(key) === value) {
    return
  }
  window.localStorage.setItem(key, value)
  if (document.querySelector(`meta[name="${DESKTOP_META_NAME}"]`)) {
    pending.set(key, value)
    queueMicrotask(() => {
      void flush()
    })
  }
}
