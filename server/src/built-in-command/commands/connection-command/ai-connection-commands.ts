import { CONFIG_MANAGER } from '@/config'
import { CONFIG_STATE } from '@/core/config-states/config-state'
import { createListResult } from '@/built-in-command/built-in-command-renderer'
import type { BuiltInCommandExecutionResult, BuiltInCommandRenderListItem } from '@/built-in-command/built-in-command'
import { discoverFellows, FellowAuthType } from '@/core/llm-manager/fellows/fellow-discovery'
import {
  MODEL_ACCOUNT_STORE,
  connectFellow,
  useModelAccount,
  unlinkModelAccount,
  startModelAccountSignIn
} from '@/core/llm-manager/llm-accounts'
import { LLM_PROVIDER_ACCOUNT_CONFIGS } from '@/core/llm-manager/llm-provider-account-configs'
import { LLMProviders } from '@/core/llm-manager/types'
import { refreshActiveProfileLLMRuntime } from '@/core/profile-runtime/initialize-profile-runtime'
import { getActiveProfileName, runWithProfileContext } from '@/core/profile-runtime/profile-context'
import { LogHelper } from '@/helpers/log-helper'
import { StringHelper } from '@/helpers/string-helper'

export const AI_CONNECTION_PARAMETER_NAME = 'ai_connection'
export const API_KEY_PARAMETER_NAME = 'api_key'

function result(title: string, items: BuiltInCommandRenderListItem[]): BuiltInCommandExecutionResult {
  return { status: 'completed', result: createListResult({ title, tone: 'info', items }) }
}

/**
 * Run explicit account actions independently of the model's inference loop.
 */
export async function executeAIConnectionCommand(
  subcommand: string,
  argument: string
): Promise<BuiltInCommandExecutionResult> {
  try {
    if (!subcommand) {
      const accounts = await MODEL_ACCOUNT_STORE.list()
      return result('My AI connections', accounts.length ? accounts.map((account) => ({
        label: account.account_label || account.provider,
        value: `${account.status}${
          CONFIG_MANAGER.getProviderConfig(account.provider.split('.')[0] || '')?.account === account.provider &&
            CONFIG_STATE.getModelState().getAgentProvider() === account.provider.split('.')[0]
            ? ' · selected' : ''}`,
        description: `/connection ai use ${account.provider}`
      })) : [{ label: 'I have no saved accounts yet. Use /connection ai discover or /connection ai connect.' }])
    }

    if (subcommand === 'use' || subcommand === 'disconnect') {
      if (!argument) {
        return result('Choose a connection', [{ label: `Use /connection ai ${subcommand} <connection>. /connection ai lists your saved connections.` }])
      }
      if (subcommand === 'use') {
        await useModelAccount(argument)
        return result('AI connection selected', [{ label: `I will use ${argument}.` }])
      }
      await unlinkModelAccount(argument)
      return result('AI connection removed', [{ label: 'I removed this connection from Leon. Your fellow app is still connected.' }])
    }

    const savedAccount = subcommand === 'connect' && argument
      ? (await MODEL_ACCOUNT_STORE.list()).find((account) => account.provider === argument)
      : undefined
    // Reconnection must use the saved method, not just the provider in the ID.
    const credentials = savedAccount
      ? await MODEL_ACCOUNT_STORE.getCredentials(argument, undefined, false, false)
      : null
    if (savedAccount && !credentials) {
      throw new Error('I could not read this connection. Use /connection ai discover to connect again.')
    }

    const savedProvider = savedAccount?.provider.split('.')[0]
    if (credentials?.['auth_kind'] === FellowAuthType.APIKey) {
      return {
        status: 'awaiting_required_parameters',
        session: {
          required_parameters: [API_KEY_PARAMETER_NAME],
          collected_parameters: { [AI_CONNECTION_PARAMETER_NAME]: argument },
          pending_input: {
            name: API_KEY_PARAMETER_NAME,
            type: 'password',
            placeholder: 'Paste your new API key',
            prompt: `Paste your new ${savedProvider} API key`,
            icon_name: 'key-2',
            icon_type: 'fill'
          }
        },
        result: createListResult({
          title: 'Replace my API key',
          tone: 'info',
          items: [{ label: 'I will save the new key for this connection.', value: argument }]
        })
      }
    }
    if (credentials?.['auth_kind'] === FellowAuthType.ClaudeCode) {
      return result('Reconnect Claude Code', [{
        label: `Sign in with claude auth login, then run /connection ai use ${argument}.`,
        description: `I use the Claude Code login folder: ${String(credentials['config_directory'] || '')}`
      }])
    }

    const accountProvider = LLM_PROVIDER_ACCOUNT_CONFIGS.find((provider) =>
      provider.accountLabel && (argument === provider.value ||
        (savedProvider === provider.value &&
          (credentials?.['auth_kind'] === FellowAuthType.ChatGPT ||
            credentials?.['auth_kind'] === provider.value)))
    )
    if (subcommand === 'connect' && accountProvider) {
      const profileName = getActiveProfileName()
      const signIn = await startModelAccountSignIn(
        accountProvider.value,
        savedAccount?.provider
      )
      // Browser consent finishes after the command has returned its link.
      void signIn.complete.then(
        () => runWithProfileContext({ profileName }, refreshActiveProfileLLMRuntime),
        (error: unknown) => {
          // A reconnect replaces prior consent; only its newest link remains valid.
          if (error instanceof Error && error.name === 'AbortError') {
            return
          }

          LogHelper.error(StringHelper.redactSecrets(
            error instanceof Error
              ? error.message
              : 'AI account sign-in did not finish. Use /connection ai to check your connection.'
          ))
        }
      ).catch(() => {
        LogHelper.warning('Your AI account connected, but its runtime reload did not finish. Use /connection ai to check your connection.')
      })
      return result(`Connect ${accountProvider.accountLabel}`, [{
        label: `Continue with ${accountProvider.accountLabel}`,
        href: signIn.url,
        description: 'Finish sign-in in your browser. I will then use your account. Use /connection ai to check the result.'
      }])
    }

    if (savedAccount) {
      throw new Error('I cannot reconnect this account type. Use /connection ai discover to connect again.')
    }

    const discovery = await discoverFellows()
    if (subcommand === 'connect' && argument) {
      const candidates = discovery.connections.filter((connection) =>
        connection.id === argument || connection.provider === argument)
      const selected = candidates.length === 1 ? candidates[0] : undefined

      if (selected) {
        if (selected.authType === FellowAuthType.ChatGPT) {
          return executeAIConnectionCommand('connect', LLMProviders.OpenAI)
        }
        const account = await connectFellow(selected)
        return result('AI connection ready', [{ label: selected.authType === FellowAuthType.ClaudeCode
          ? 'I will use the account signed in to Claude Code.' : `I connected ${selected.sources.join(', ')}.`, value: account.provider }])
      }

      if (!candidates.length && CONFIG_STATE.getModelState().isSupportedProvider(argument)) {
        return result('Connect an AI service', [{
          label: `Use /model ${argument} <model> to add an API key.`,
          description: argument === LLMProviders.Anthropic
            ? 'For a Claude subscription, sign in with claude auth login, then run /connection ai discover.' : ''
        }])
      }
    }

    return result('My AI fellows', [
      { label: discovery.fellows.length ? `I found ${discovery.fellows.join(', ')}.` : 'I did not find any other AI apps.' },
      ...discovery.connections.map((connection) => ({
        label: `${connection.provider} · ${connection.authType === FellowAuthType.APIKey ? 'API key' : 'subscription'}`,
        value: `${connection.sources.join(', ')} · ${connection.model}`,
        description: `/connection ai connect ${connection.id}`
      })),
      ...LLM_PROVIDER_ACCOUNT_CONFIGS.filter((provider) => provider.accountLabel).map((provider) => ({
        label: `Continue with ${provider.accountLabel}`,
        description: `/connection ai connect ${provider.value}`
      })),
      { label: 'Add an API key', description: '/model <provider> <model>' },
      ...discovery.issues.map((issue) => ({ label: issue, tone: 'warning' as const }))
    ])
  } catch (error) {
    return {
      status: 'error',
      result: createListResult({
        title: 'AI connection needs attention',
        tone: 'error',
        items: [{ label: error instanceof Error ? error.message : 'I could not connect this account.' }]
      })
    }
  }
}
