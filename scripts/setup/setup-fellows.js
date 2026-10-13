import execa from 'execa'

import { discoverFellows, FellowAuthType } from '@/core/llm-manager/fellows/fellow-discovery'
import { connectFellow, startModelAccountSignIn } from '@/core/llm-manager/llm-accounts'
import {
  getLLMProviderAccountConfig,
  getRequiredLLMProviderAccountConfig
} from '@/core/llm-manager/llm-provider-account-configs'
import { LLMProviders } from '@/core/llm-manager/types'
import { StringHelper } from '@/helpers/string-helper'

import { SetupUI, setupConsola } from './setup-ui'
import { createSetupStatus } from './setup-status'

const CONTINUE_SETUP = 'continue'

/**
 * Finish account consent in the owner's browser, including during manual setup.
 */
export async function setupModelAccount(provider, model = '') {
  const metadata = getRequiredLLMProviderAccountConfig(provider)
  const signIn = await startModelAccountSignIn(provider, undefined, model)

  try {
    SetupUI.info(`Continue with ${metadata.accountLabel}: ${SetupUI.underlined(signIn.url)}`)
    // The printed URL also works when this machine has no browser available.
    const command = process.platform === 'win32' ? 'rundll32'
      : process.platform === 'darwin' ? 'open' : 'xdg-open'
    const args = process.platform === 'win32'
      ? ['url.dll,FileProtocolHandler', signIn.url] : [signIn.url]
    await execa(command, args, { reject: false }).catch(() => undefined)
    const account = await signIn.complete
    SetupUI.info(`Your ${metadata.accountLabel} account is connected to me.`)

    return { fellowAccount: account.provider }
  } finally {
    signIn.cancel()
  }
}

/**
 * Offer existing connections before asking about manual or local AI setup.
 */
export default async function setupFellows() {
  const status = createSetupStatus('I am checking for other AI apps. I call them my fellows.').start()
  const discovery = await discoverFellows()
  status.succeed(discovery.fellows.length
    ? `I found these AI fellows on your machine: ${discovery.fellows.join(', ')}.`
    : 'I did not find any other AI apps.')

  if (!discovery.connections.length) {
    return null
  }

  SetupUI.info('I can connect to your AI account or reuse an API key so we can start getting to know each other.')

  // Keep one suggestion per provider and method in discovery priority order.
  // The full inventory remains available through /connection ai discover.
  const offered = new Set()
  const connections = discovery.connections.filter((connection) => {
    const choice = `${connection.provider}:${connection.authType}`
    if (offered.has(choice)) {
      return false
    }

    offered.add(choice)
    return true
  })
  const options = connections.map((connection) => ({
    value: connection.id,
    label: connection.authType === FellowAuthType.ChatGPT
      ? 'Bind with my ChatGPT account' : connection.authType === FellowAuthType.ClaudeCode
        ? 'Use my Claude Code subscription'
        : `Reuse my ${getLLMProviderAccountConfig(connection.provider)?.label || connection.provider} API key from ${connection.sources[0]}`
  }))
  options.push({ value: CONTINUE_SETUP, label: 'Continue without these connections' })

  for (;;) {
    const selected = await setupConsola.prompt('Which connection should I use?', {
      type: 'select',
      options,
      initial: options[0].value,
      cancel: 'null'
    })
    if (selected === CONTINUE_SETUP) {
      return null
    }

    const connection = discovery.connections.find((candidate) => candidate.id === selected)
    if (!connection) {
      return null
    }

    try {
      if (connection.authType === FellowAuthType.ChatGPT) {
        return await setupModelAccount(LLMProviders.OpenAI, connection.model)
      }

      if (connection.authType === FellowAuthType.ClaudeCode) {
        SetupUI.info('I will use the account signed in to Claude Code.')
      }
      const account = await connectFellow(connection)
      SetupUI.info(`I will use your ${connection.provider} connection.`)
      return { fellowAccount: account.provider }
    } catch (error) {
      SetupUI.info(StringHelper.redactSecrets(
        error instanceof Error
          ? error.message
          : 'I could not connect this account. Please choose another connection or continue setup.'
      ))
    }
  }
}
