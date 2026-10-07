export const CHATGPT_CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex'
export const CHATGPT_CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
export const CHATGPT_CODEX_AUTH_FLOW = 'codex'
export const CHATGPT_CODEX_DEFAULT_IMAGE_MODEL = 'gpt-image-2'
export const CHATGPT_ACCOUNT_CLAIM = 'https://api.openai.com/auth'
export const CHATGPT_ORIGINATOR = 'leon'

/**
 * Keeps token-sharing credentials off the Codex product's endpoints.
 */
export function requireChatGPTCodexAccount(
  credentials: Record<string, unknown>,
  accountID?: string
): void {
  if (credentials['auth_kind'] !== 'chatgpt' ||
    credentials['auth_flow'] !== CHATGPT_CODEX_AUTH_FLOW ||
    typeof credentials['access_token'] !== 'string' || !credentials['access_token'] ||
    typeof credentials['chatgpt_account_id'] !== 'string' || !credentials['chatgpt_account_id']) {
    throw new Error(
      `Please reconnect your ChatGPT subscription with /connection ai connect ${accountID || 'openai'} to authorize chat and image generation.`
    )
  }
}

/**
 * Selects the authorized ChatGPT workspace separately from Leon's connection ID.
 */
export function chatGPTAccountHeaders(
  credentials: Record<string, unknown>
): Record<string, string> {
  return {
    authorization: `Bearer ${String(credentials['access_token'])}`,
    'chatgpt-account-id': String(credentials['chatgpt_account_id']),
    originator: CHATGPT_ORIGINATOR
  }
}
