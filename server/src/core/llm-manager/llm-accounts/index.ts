import { randomUUID } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'

import { getLLMProviderAccountConfig } from '@/core/llm-manager/llm-provider-account-configs'
import { CONFIG_MANAGER } from '@/config'
import { ConnectionStore, type ConnectionSummary } from '@/core/connections/connection-store'
import { CONFIG_STATE } from '@/core/config-states/config-state'
import { LLMProviders } from '../types'
import { isClaudeSubscriptionAvailable } from '../fellows/fellow-catalog'
import { FellowAuthType, readFellowAPIKey, type FellowConnection } from '../fellows/fellow-discovery'

const CONNECTION_CHECK_TIMEOUT_MS = 10_000

export interface LLMAccountSignIn {
  url: string
  complete: Promise<ConnectionSummary>
  cancel: () => void
}

/**
 * Start a supported provider's own account consent flow.
 */
export async function startModelAccountSignIn(
  provider: LLMProviders,
  accountID?: string,
  preferredModel = ''
): Promise<LLMAccountSignIn> {
  if (provider === LLMProviders.OpenAI) {
    const { startChatGPTSignIn } = await import('./llm-account-chatgpt')
    return startChatGPTSignIn(accountID, preferredModel)
  }

  if (provider === LLMProviders.OpenRouter) {
    const { startOpenRouterSignIn } = await import('./llm-account-openrouter')
    return startOpenRouterSignIn(accountID, preferredModel)
  }

  throw new Error('This provider does not support account sign-in with me.')
}

/**
 * Reuse profile encryption and mutation locks, with LLM-specific token refresh.
 */
export const MODEL_ACCOUNT_STORE = new ConnectionStore('llm-accounts', async (id, credentials) => {
  try {
    const { refreshChatGPTAccount } = await import('./llm-account-chatgpt')
    return await refreshChatGPTAccount(credentials)
  } catch {
    throw new Error(`I need you to reconnect this account with /connection ai connect ${id}.`)
  }
})

/**
 * Select a saved account without copying secrets into global process variables.
 */
export async function useModelAccount(id: string, model?: string): Promise<void> {
  const summary = (await MODEL_ACCOUNT_STORE.list()).find((account) => account.provider === id)
  const selectedProvider = id.split('.')[0] as LLMProviders

  if (!summary || !Object.values(LLMProviders).includes(selectedProvider)) {
    throw new Error('I could not find that saved account. Use /connection ai.')
  }

  const credentials = await MODEL_ACCOUNT_STORE.getCredentials(id)
  if (!credentials) {
    throw new Error('I could not read that account. Please connect it again.')
  }

  const selectedModel = model || String(credentials['model'] || '')

  if (!selectedModel) {
    throw new Error('This account does not have an available model.')
  }

  await CONFIG_MANAGER.setValue(['llm', 'providers', selectedProvider, 'account'], id)
  await CONFIG_STATE.getModelState().setUnifiedTarget(`${selectedProvider}/${selectedModel}`)
}

/**
 * Save only the selected fellow connection. Claude manages its own credentials;
 * ChatGPT requires Leon's own consent flow rather than copying a CLI token.
 */
export async function connectFellow(connection: FellowConnection): Promise<ConnectionSummary> {
  if (connection.authType === FellowAuthType.ChatGPT) {
    throw new Error('Use Continue with ChatGPT to connect this account to me.')
  }

  const credentials: Record<string, unknown> = {
    auth_kind: connection.authType,
    model: connection.model,
    ...(connection.configDirectory ? { config_directory: connection.configDirectory } : {})
  }

  if (connection.authType === FellowAuthType.APIKey) {
    credentials['api_key'] = await readFellowAPIKey(connection)
    const baseURL = connection.baseURL || getLLMProviderAccountConfig(connection.provider)?.baseURL
    credentials['base_url'] = baseURL

    if (baseURL) {
      const response = await fetch(`${baseURL.replace(/\/$/, '')}/models`, {
        headers: connection.provider === LLMProviders.Anthropic ? {
          'x-api-key': String(credentials['api_key']),
          'anthropic-version': '2023-06-01'
        } : { authorization: `Bearer ${String(credentials['api_key'])}` },
        signal: AbortSignal.timeout(CONNECTION_CHECK_TIMEOUT_MS),
        redirect: 'error'
      }).catch(() => null)
      // Some compatible providers do not expose model listing. Authentication
      // rejection is definitive; other errors leave the owner able to select it.
      if (response?.status === 401 || response?.status === 403) {
        throw new Error('This API key was rejected. Please choose another connection.')
      }
    }
  } else {
    const directory = connection.configDirectory ||
      process.env['CLAUDE_CONFIG_DIR'] || path.join(os.homedir(), '.claude')
    if (!await isClaudeSubscriptionAvailable(directory)) {
      throw new Error('Please sign in with claude auth login, then run /connection ai discover again.')
    }
    credentials['config_directory'] = directory
  }

  const account = await MODEL_ACCOUNT_STORE.save({
    provider: `${connection.provider}.${randomUUID()}`,
    // Claude Code is a local authorization reference; its CLI owns token refresh.
    auth_type: connection.authType === FellowAuthType.APIKey ? 'api_key' : 'oauth',
    credentials,
    account_label: `${connection.sources.join(', ')} (${connection.authType === FellowAuthType.APIKey ? 'API key' : 'Claude subscription'})`
  })

  await useModelAccount(account.provider, connection.model)

  return account
}

/**
 * Forget Leon's account without signing the owner out of their fellow app.
 */
export async function unlinkModelAccount(id: string): Promise<void> {
  const selectedProvider = id.split('.')[0] || ''

  if (CONFIG_MANAGER.getProviderConfig(selectedProvider)?.account === id) {
    const modelState = CONFIG_STATE.getModelState()
    if (modelState.getAgentProvider() === selectedProvider ||
      modelState.getWorkflowProvider() === selectedProvider) {
      // Removing the active account must not silently fall back to another key.
      await modelState.setUnifiedTarget('')
    }
    await CONFIG_MANAGER.deleteValue(['llm', 'providers', selectedProvider, 'account'])
  }
  await MODEL_ACCOUNT_STORE.remove(id)
}

/**
 * Resolve credentials for the current profile's explicit provider binding.
 */
export async function getModelAccountCredentials(
  selectedProvider: string
): Promise<Record<string, unknown> | null> {
  const id = CONFIG_MANAGER.getProviderConfig(selectedProvider)?.account

  if (!id) {
    return null
  }

  try {
    const credentials = await MODEL_ACCOUNT_STORE.getCredentials(id)
    if (!credentials) {
      throw new Error('The selected connection is missing.')
    }
    return { ...credentials, account_id: id }
  } catch {
    await MODEL_ACCOUNT_STORE.markNeedsAttention(id)
    throw new Error(`I need you to reconnect this account with /connection ai connect ${id}.`)
  }
}
