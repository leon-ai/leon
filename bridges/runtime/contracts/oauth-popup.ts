export const DESKTOP_LOOPBACK_HOST = '127.0.0.1'
export const DESKTOP_OAUTH_PATH = '/__desktop/oauth'
export const DESKTOP_OAUTH_META_NAME = 'leon-desktop-oauth'
export const OAUTH_ATTEMPT_TIMEOUT_MS = 10 * 60_000

const POPUP_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const MAXIMUM_PROVIDER_LENGTH = 256

/**
 * Keeps browser handoffs on credential-free HTTP or HTTPS URLs.
 */
export function isOAuthAuthorizationURL(value: string): boolean {
  try {
    const url = new URL(value)

    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
  } catch {
    return false
  }
}

/**
 * Identifies the landing page that signals completion to the originating client.
 */
export function getOAuthCompletionPath(apiVersion: string): string {
  return `/api/${apiVersion}/connections/complete`
}

/**
 * Restricts Desktop OAuth returns to its loopback gateway and a single attempt.
 * A completed return may also carry the provider and the outcome of that attempt.
 */
export function isDesktopOAuthReturn(
  url: URL,
  apiVersion: string,
  completed = false
): boolean {
  const parameters = url.searchParams
  const popupId = parameters.get('popup_id')

  if (
    url.protocol !== 'http:' ||
    url.hostname !== DESKTOP_LOOPBACK_HOST ||
    !url.port ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname !== getOAuthCompletionPath(apiVersion) ||
    !popupId ||
    !POPUP_ID_PATTERN.test(popupId)
  ) {
    return false
  }

  if (!completed) {
    return parameters.size === 1
  }

  const provider = parameters.get('provider')
  const result = parameters.get('connection_result')

  return parameters.size === 3 &&
    !!provider && provider.length <= MAXIMUM_PROVIDER_LENGTH &&
    (result === 'connected' || result === 'failed')
}
