import { randomBytes } from 'node:crypto'

import { CONNECTION_AUTHORIZATION_CHANNEL, type ConnectionAuthorizationCompletion } from '../../../../aurora/src/contracts/connection-setup'

const MAXIMUM_POPUP_ID_LENGTH = 128
const MAXIMUM_PROVIDER_LENGTH = 256

/**
 * Notifies only the originating browser attempt, without exposing account data
 * or requiring an opener relationship with the external authorization page.
 */
export function renderOAuthCompletion(input: {
  popup_id?: string
  provider?: string
  connection_result?: string
}): { html: string, contentSecurityPolicy: string } | undefined {
  if (typeof input.popup_id !== 'string' || !input.popup_id || input.popup_id.length > MAXIMUM_POPUP_ID_LENGTH ||
    typeof input.provider !== 'string' || !input.provider || input.provider.length > MAXIMUM_PROVIDER_LENGTH ||
    !['connected', 'failed'].includes(input.connection_result ?? '')) {
    return undefined
  }

  const completion: ConnectionAuthorizationCompletion = {
    id: input.popup_id,
    provider: input.provider,
    result: input.connection_result as ConnectionAuthorizationCompletion['result']
  }
  const data = JSON.stringify(completion).replaceAll('<', '\\u003c')
  const channel = JSON.stringify(`${CONNECTION_AUTHORIZATION_CHANNEL}${completion.id}`).replaceAll('<', '\\u003c')
  const nonce = randomBytes(24).toString('base64')

  return {
    contentSecurityPolicy: `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connection complete</title></head><body><p>You can return to your conversation.</p><script nonce="${nonce}">
const channel = new BroadcastChannel(${channel});
channel.postMessage(${data});
channel.close();
window.close();
</script></body></html>`
  }
}
