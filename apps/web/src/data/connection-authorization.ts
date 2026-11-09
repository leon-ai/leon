import { CONNECTION_AUTHORIZATION_CHANNEL, CONNECTION_SETUP_MESSAGES,
  type ConnectionAuthorizationCompletion } from '../../../../aurora/src/contracts/connection-setup'
import { isPresentationURL } from '../../../../aurora/src/v2/contracts/presentation'

const AUTHORIZATION_TIMEOUT_MS = 10 * 60_000
const CLOSED_CHECK_INTERVAL_MS = 500

type AuthorizationOutcome = ConnectionAuthorizationCompletion['result'] | 'closed'

/**
 * Marks safe browser setup errors that contain no provider or credential data.
 */
export class ConnectionAuthorizationError extends Error {}

export interface ConnectionAuthorizationPopup {
  returnURL: string
  authorize: (url: string, signal: AbortSignal) => Promise<AuthorizationOutcome>
  dispose: () => void
}

/**
 * Reserves a window during the owner gesture. A same-origin, per-attempt channel
 * survives provider isolation headers without granting the provider an opener.
 * Completion is only a refresh signal; the authenticated server owns status.
 */
export function openConnectionAuthorization(provider: string): ConnectionAuthorizationPopup {
  const id = crypto.randomUUID()
  const popup = window.open('about:blank', '_blank', 'popup,width=560,height=720')
  if (!popup) {
    throw new ConnectionAuthorizationError(CONNECTION_SETUP_MESSAGES.popupBlocked)
  }
  let channel: BroadcastChannel
  try {
    popup.opener = null
    popup.document.title = 'Connect account'
    channel = new BroadcastChannel(`${CONNECTION_AUTHORIZATION_CHANNEL}${id}`)
  } catch {
    popup.close()
    throw new ConnectionAuthorizationError(CONNECTION_SETUP_MESSAGES.actionError)
  }
  const completion = Promise.withResolvers<AuthorizationOutcome>()
  let settled = false

  function dispose(result: AuthorizationOutcome = 'closed'): void {
    if (settled) {
      return
    }
    settled = true
    clearTimeout(timeout)
    clearInterval(closedCheck)
    channel.close()
    popup?.close()
    completion.resolve(result)
  }

  channel.onmessage = (event: MessageEvent<ConnectionAuthorizationCompletion>): void => {
    const value = event.data
    if (value?.id === id && value.provider === provider &&
      (value.result === 'connected' || value.result === 'failed')) {
      dispose(value.result)
    }
  }
  const timeout = setTimeout(dispose, AUTHORIZATION_TIMEOUT_MS)
  const closedCheck = setInterval(() => {
    // COOP can sever the window handle while authorization still has focus.
    // Treat it as a return only once the owner is back in the conversation.
    if (popup.closed && document.hasFocus()) {
      dispose()
    }
  }, CLOSED_CHECK_INTERVAL_MS)
  const returnURL = new URL('/api/v1/connections/complete', window.location.origin)
  returnURL.searchParams.set('popup_id', id)

  return {
    returnURL: returnURL.toString(),
    dispose,
    authorize: async (url, signal): Promise<AuthorizationOutcome> => {
      signal.throwIfAborted()
      if (settled || !isPresentationURL(url)) {
        dispose()
        throw new ConnectionAuthorizationError(CONNECTION_SETUP_MESSAGES.actionError)
      }
      const abort = (): void => dispose()
      signal.addEventListener('abort', abort, { once: true })
      try {
        popup.location.replace(url)
        const outcome = await completion.promise
        signal.throwIfAborted()

        return outcome
      } finally {
        signal.removeEventListener('abort', abort)
        dispose()
      }
    }
  }
}
