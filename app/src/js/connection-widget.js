import axios from 'axios'

/**
 * Transports server-owned screens and actions. Credentials use authenticated HTTP only.
 */
export function createConnectionWidgetProps(
  socket,
  provider,
  sessionId,
  serverURL = '',
  messages
) {
  const url = `${serverURL}/api/v1/connections/${encodeURIComponent(provider)}/setup`
  const request = async (action, state, credentials = {}) => {
    const returnURL = new URL(window.location.href)

    if (sessionId) {
      returnURL.searchParams.set('connection_session', sessionId)
    }

    const authorizationFailed =
      returnURL.searchParams.get('provider') === provider &&
      returnURL.searchParams.has('connection_result') &&
      returnURL.searchParams.get('connection_result') !== 'connected'
    const { data } = await axios.post(url, {
      action: action.id,
      method: action.method,
      state,
      credentials,
      session_id: sessionId,
      return_url: returnURL.toString(),
      authorization_failed: authorizationFailed
    })

    if (
      returnURL.searchParams.get('provider') === provider &&
      returnURL.searchParams.has('connection_result')
    ) {
      returnURL.searchParams.delete('provider')
      returnURL.searchParams.delete('connection_result')
      returnURL.searchParams.delete('connection_session')
      window.history.replaceState({}, '', returnURL)
    }

    if (data.event) {
      socket.emit('widget-event', {
        method: data.event,
        sessionId: data.event.session_id
      })
    }

    if (data.authorization_url) {
      window.location.assign(data.authorization_url)
    }

    return data.view
  }

  return {
    provider,
    messages,
    onLoad: (state) => request({ id: 'refresh' }, state),
    onAction: request
  }
}
