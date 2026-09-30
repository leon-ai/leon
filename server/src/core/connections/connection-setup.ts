import type { ConnectionSetupAction, ConnectionSetupView } from '@aurora'

import { CONVERSATION_SESSION_MANAGER } from '@/core/session-manager'
import { ensureActiveProfileRuntime } from '@/core/profile-runtime/initialize-profile-runtime'
import {
  getActiveProfileName,
  runWithProfileContext
} from '@/core/profile-runtime/profile-context'
import { isValidProfileName } from '@/core/profile-runtime/profile-paths'
import { getConnectionCatalog, getConnectionCallbackURL } from './connection-catalog'
import { CONNECTION_STORE, ConnectionStatus } from './connection-store'
import { saveConnection, startConnectionOAuth } from './connection-service'

const MAXIMUM_CREDENTIAL_LENGTH = 4_096

export const CONNECTION_SETUP_MESSAGES = {
  loadError: 'Unable to load connection setup. Please try again.',
  actionError:
    'Unable to complete this step. Check the setup fields and account permissions, then try again.',
  retry: 'Retry',
  copied: 'Copied',
  copyFailed: 'Select and copy the text above.'
}

enum SetupAction {
  Refresh = 'refresh',
  SelectMethod = 'select_method',
  Manual = 'manual',
  Credentials = 'credentials',
  StartSetup = 'start_setup',
  Connect = 'connect',
  Continue = 'continue'
}

enum SetupStep {
  Choice = 'choice',
  Application = 'application',
  Credentials = 'credentials',
  Assisted = 'assisted',
  Connected = 'connected',
  Continued = 'continued'
}

export interface ConnectionSetupInput {
  provider: string
  profile_id?: string
  session_id: string
  callback_origin: string
  api_version: string
  return_url?: string
  action: string
  method?: string
  state?: ConnectionSetupView['state']
  credentials?: Record<string, string>
  authorization_failed?: boolean
  setup_values?: Record<string, string>
}

export interface ConnectionSetupResult {
  view: ConnectionSetupView
  // The host dispatches this through its normal owner-message path, preserving history.
  event?: {
    methodName: 'send_utterance'
    methodParams: { from: 'owner', utterance: string }
    session_id: string
  }
  authorization_url?: string
}

/**
 * Owns the connection wizard for browser clients and HTTP plugins alike.
 * Every screen is rebuilt from current profile metadata; client state carries no authority.
 */
export async function handleConnectionSetup(
  input: ConnectionSetupInput
): Promise<ConnectionSetupResult> {
  const profileName = input.profile_id?.trim() || getActiveProfileName()

  if (!isValidProfileName(profileName)) {
    throw new Error('Invalid profile name.')
  }

  return runWithProfileContext({ profileName }, async () => {
    await ensureActiveProfileRuntime()
    if (
      !input.session_id ||
      !CONVERSATION_SESSION_MANAGER.getSession(input.session_id)
    ) {
      throw new Error('A conversation in this profile is required.')
    }

    if (!Object.values(SetupAction).includes(input.action as SetupAction)) {
      throw new Error('Unknown connection setup action.')
    }

    const tool = (await getConnectionCatalog({
      origin: input.callback_origin,
      apiVersion: input.api_version,
      ...(input.setup_values ? { setup_values: input.setup_values } : {})
    })).find(
      (entry) => `${entry.toolkit_id}.${entry.tool_id}` === input.provider
    )

    if (!tool) {
      throw new Error('This tool is no longer available.')
    }

    const methodId = input.method || input.state?.method
    const method = methodId
      ? tool.methods.find((entry) => entry.id === methodId)
      : tool.methods[0]

    if (!method) {
      throw new Error('Unknown connection method.')
    }

    let step = Object.values(SetupStep).includes(input.state?.step as SetupStep)
      ? (input.state!.step as SetupStep)
      : SetupStep.Choice
    let connection = (await CONNECTION_STORE.list()).find(
      (entry) => entry.provider === input.provider
    )
    const connected = (): boolean =>
      connection?.status === ConnectionStatus.Connected
    const needsApplication =
      method.id === 'oauth' && Object.keys(method.settings).length > 0
    let event: ConnectionSetupResult['event']
    let authorizationURL: string | undefined
    const ownerMessage = (
      utterance: string
    ): NonNullable<ConnectionSetupResult['event']> => ({
      methodName: 'send_utterance',
      methodParams: { from: 'owner', utterance },
      session_id: input.session_id
    })

    switch (input.action) {
      case SetupAction.SelectMethod:
        step = SetupStep.Choice
        break
      case SetupAction.Manual:
        step = needsApplication ? SetupStep.Application : SetupStep.Credentials
        break
      case SetupAction.Credentials:
        step = SetupStep.Credentials
        break
      case SetupAction.StartSetup:
        if (!connected()) {
          step = SetupStep.Assisted
          event = ownerMessage(
            [
              `Help me connect ${tool.name} using ${method.name} in my browser, then continue my request.`,
              ...Object.entries(method.setup?.values || {}).map(
                ([name, value]) => `${name}: ${value}`
              ),
              'Ask me when permission is needed. Keep credentials out of chat.'
            ].join('\n')
          )
        }

        break
      case SetupAction.Connect: {
        if (connected()) {
          break
        }

        // Only accept fields declared by the tool; never return submitted values.
        const credentials = Object.fromEntries(
          Object.entries(method.settings).map(([key, fallback]) => {
            const value = input.credentials?.[key] ?? fallback ?? ''

            if (
              typeof value !== 'string' ||
              value.length > MAXIMUM_CREDENTIAL_LENGTH ||
              (fallback === null && !value.trim())
            ) {
              throw new Error('Complete the required connection fields.')
            }

            return [key, value.trim()]
          })
        )

        if (method.id === 'oauth') {
          const result = await startConnectionOAuth({
            provider: input.provider,
            callbackOrigin: input.callback_origin,
            apiVersion: input.api_version,
            // Native clients return to a secret-free page at the public callback
            // origin, rather than the integration server's private request host.
            returnURL: input.return_url || new URL(
              '../complete',
              getConnectionCallbackURL(input.callback_origin, input.api_version)
            ).toString(),
            ...(credentials['client_id']
              ? { clientId: credentials['client_id'] }
              : {}),
            ...(credentials['client_secret']
              ? { clientSecret: credentials['client_secret'] }
              : {})
          })

          authorizationURL = result.authorization_url
        } else if (method.id === 'api_key') {
          connection = await saveConnection({
            provider: input.provider,
            auth_type: method.id,
            credentials
          })
        } else {
          throw new Error('Unsupported connection method.')
        }

        break
      }
      case SetupAction.Continue:
        if (!connected()) {
          throw new Error('Connect the account before continuing.')
        }

        step = SetupStep.Continued
        event = ownerMessage('Continue.')
        break
    }

    if (connected() && step !== SetupStep.Continued) {
      step = SetupStep.Connected
    }

    if (
      !connected() &&
      [SetupStep.Connected, SetupStep.Continued].includes(step)
    ) {
      step = SetupStep.Choice
    }

    const action = (
      id: SetupAction,
      label: string,
      secondary = false
    ): ConnectionSetupAction => ({ id, label, secondary })
    const view: ConnectionSetupView = {
      state: { method: method.id, step },
      title: connected() ? tool.name : `Set up ${tool.name}`,
      description: '',
      fields: [],
      links: [],
      actions: [],
      messages: CONNECTION_SETUP_MESSAGES,
      ...(input.authorization_failed
        ? { notice: 'Authorization did not complete. Please try again.' }
        : {})
    }

    if (connected()) {
      view.status = `Connected${connection?.account_label ? ` · ${connection.account_label}` : ''}`
      view.description =
        step === SetupStep.Continued
          ? 'Continuing your request in the conversation.'
          : 'You can continue your request.'
      if (step !== SetupStep.Continued) {
        view.actions.push(action(SetupAction.Continue, 'Continue'))
      }
    } else {
      if (tool.methods.length > 1) {
        view.actions.push(
          ...tool.methods.map((entry) => ({
            ...action(
              SetupAction.SelectMethod,
              entry.name,
              entry.id !== method.id
            ),
            method: entry.id
          }))
        )
      }

      if (step === SetupStep.Choice || step === SetupStep.Assisted) {
        view.description =
          step === SetupStep.Assisted
            ? 'You can follow setup progress in this conversation.'
            : 'Your assistant will complete setup in your browser.'
        if (step === SetupStep.Choice) {
          view.actions.push(
            action(SetupAction.StartSetup, 'Set it up for me')
          )
        }

        view.actions.push(action(SetupAction.Manual, 'Set up manually', true))
      } else {
        view.description =
          step === SetupStep.Application
            ? 'Create an application once, then return here with its application credentials.'
            : needsApplication
              ? 'Enter the application credentials, then authorize access on the provider’s website.'
              : method.description
        view.links.push({
          label: `Open ${tool.name} setup`,
          href: method.setup_url
        })
        view.details = {
          label: 'Show setup instructions',
          instructions: method.setup?.instructions || [],
          values: [
            ...Object.entries(method.setup?.values || {}).map(
              ([label, value]) => ({ label, value })
            ),
            ...(method.redirect_uri
              ? [{ label: 'Redirect URI', value: method.redirect_uri }]
              : [])
          ].map((item) => ({
            ...item,
            copyLabel: `Copy ${item.label.toLowerCase()}`
          }))
        }
        if (step === SetupStep.Application) {
          view.actions.push(
            action(SetupAction.Credentials, 'I have my application credentials')
          )
        } else {
          view.fields = Object.entries(method.settings).map(
            ([name, fallback]) => ({
              name,
              label:
                name === 'client_id' ? 'Client ID' : name.split('_').join(' '),
              type: name === 'client_id' ? 'text' : 'password',
              required: fallback === null,
              value: fallback || '',
              maxLength: MAXIMUM_CREDENTIAL_LENGTH
            })
          )
          view.actions.push({
            ...action(SetupAction.Connect, `Connect ${tool.name}`),
            submit: true
          })
          if (needsApplication) {
            view.actions.push(
              action(SetupAction.Manual, 'Back to setup instructions', true)
            )
          }
        }

        view.actions.push(
          action(SetupAction.StartSetup, 'Set it up for me', true)
        )
      }
    }

    return {
      view,
      ...(event ? { event } : {}),
      ...(authorizationURL ? { authorization_url: authorizationURL } : {})
    }
  })
}
