import {
  chatGPTAccountHeaders,
  requireChatGPTCodexAccount
} from './chatgpt-account-config'

function authenticationStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined
  }

  const details = error as Record<string, unknown>
  const status = details['statusCode'] ?? details['status']
  if (status === 401 || status === 403) {
    return status
  }

  return undefined
}

/**
 * Refreshes rejected authorization once before execution, without changing accounts.
 * Responses and native media requests use the same profile refresh lock.
 */
export async function requestChatGPTAccount(
  accountID: string,
  dispatch: (headers: Record<string, string>) => Promise<Response>
): Promise<Response> {
  const { MODEL_ACCOUNT_STORE } = await import('./index')
  const send = async (forceRefresh = false): Promise<Response> => {
    const credentials = forceRefresh
      ? await MODEL_ACCOUNT_STORE.getCredentials(accountID, undefined, true)
      : await MODEL_ACCOUNT_STORE.getCredentials(accountID)

    requireChatGPTCodexAccount(credentials || {}, accountID)
    const response = await dispatch(chatGPTAccountHeaders(credentials!))
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel()
      throw Object.assign(new Error('ChatGPT authorization was rejected.'), {
        statusCode: response.status
      })
    }

    return response
  }

  try {
    return await send()
  } catch (error) {
    const status = authenticationStatus(error)
    if (!status) {
      throw error
    }

    if (status === 401) {
      try {
        return await send(true)
      } catch (retryError) {
        if (!authenticationStatus(retryError)) {
          throw retryError
        }
      }
    }

    await MODEL_ACCOUNT_STORE.markNeedsAttention(accountID)
    throw new Error(`I need you to reconnect this account with /connection ai connect ${accountID}.`)
  }
}
