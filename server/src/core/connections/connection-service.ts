import { HOST, IS_PRODUCTION_ENV, WEB_APP_DEV_SERVER_PORT } from '@/constants'
import { CONFIG_MANAGER } from '@/config'
import { TOOLKIT_REGISTRY, TOOL_WORKER_MANAGER } from '@/core'
import {
  getActiveProfileName,
  runWithProfileContext
} from '@/core/profile-runtime/profile-context'
import { ensureActiveProfileRuntime } from '@/core/profile-runtime/initialize-profile-runtime'
import {
  CONNECTION_STORE,
  OAUTH_APPLICATION_STORE,
  type ConnectionSummary,
  type SaveConnectionInput
} from './connection-store'
import {
  getConnectionCallbackURL,
  getOAuthClientSettings,
  getToolCredentials
} from './connection-catalog'
import { OAUTH_MANAGER } from './oauth-manager'

/**
 * Stores application credentials separately; account authorization happens later.
 */
export async function saveOAuthApplicationSettings(
  provider: string,
  credentials: Record<string, unknown>
): Promise<void> {
  await OAUTH_APPLICATION_STORE.save({ provider, auth_type: 'oauth', credentials })
  // Verify encrypted read-back before clearing any legacy plaintext settings.
  await getOAuthClientSettings(provider)
}

/**
 * Validates through the ordinary tool worker before saving an account connection.
 */
export async function saveConnection(
  input: SaveConnectionInput,
  profileName = getActiveProfileName()
): Promise<ConnectionSummary> {
  return runWithProfileContext({ profileName }, async () => {
    await ensureActiveProfileRuntime()
    const tool = TOOLKIT_REGISTRY.getConnectionTool(input.provider)

    if (
      !input.credentials ||
      typeof input.credentials !== 'object' ||
      Array.isArray(input.credentials) ||
      !tool.connection.methods[input.auth_type] ||
      tool.connection.required_settings.some(
        (key) =>
          typeof input.credentials[key] !== 'string' ||
          !String(input.credentials[key]).trim()
      )
    ) {
      throw new Error(
        'Provide the required credentials for a declared authentication method.'
      )
    }

    const result = await TOOL_WORKER_MANAGER.execute(
      {
        toolkitId: tool.toolkit_id,
        toolId: tool.tool_id,
        functionName: 'validateConnection',
        profileName,
        conversationSessionId: null,
        parameters: {},
        connections: {
          [input.provider]: getToolCredentials(
            input.provider,
            input.credentials
          )
        }
      },
      [],
      () => undefined
    )

    if (!result.success) {
      throw new Error(
        'Account verification failed. Check the credentials and permissions, then try again.'
      )
    }

    const account = result.output['result'] as
      | { account_label?: string }
      | undefined
    const credentials = { ...input.credentials }

    if (input.auth_type === 'oauth') {
      const method = tool.connection.methods.oauth!
      const clientSettings = Object.fromEntries(
        Object.keys(method.settings).map((key) => [key, credentials[key]])
      )

      // Encrypt application credentials only after successful account validation.
      if (
        typeof clientSettings['client_id'] === 'string' &&
        clientSettings['client_id'].trim()
      ) {
        if (
          Object.entries(method.settings).some(
            ([key, fallback]) =>
              fallback === null &&
              (typeof clientSettings[key] !== 'string' ||
                !String(clientSettings[key]).trim())
          )
        ) {
          throw new Error('Complete the required OAuth application settings.')
        }

        try {
          await saveOAuthApplicationSettings(input.provider, clientSettings)
        } catch {
          throw new Error(
            'Unable to save OAuth application settings for this tool.'
          )
        }
      }

      for (const key of Object.keys(method.settings)) {
        delete credentials[key]
      }

      delete credentials['client_secret']
    }

    return CONNECTION_STORE.save(
      {
        provider: input.provider,
        auth_type: input.auth_type,
        credentials,
        ...(input.scopes ? { scopes: input.scopes } : {}),
        ...(account?.account_label
          ? { account_label: account.account_label }
          : {})
      },
      profileName
    )
  })
}

export interface StartConnectionOAuthInput {
  provider: string
  profileName?: string
  callbackOrigin: string
  returnURL: string
  apiVersion: string
  clientId?: string
  clientSecret?: string
}

/**
 * Starts the same profile-bound OAuth flow for HTTP clients and trusted plugins.
 */
export async function startConnectionOAuth(
  input: StartConnectionOAuthInput
): Promise<{
  authorization_url: string
  redirect_uri: string
  scopes: string[]
}> {
  const profileName = input.profileName || getActiveProfileName()

  return runWithProfileContext({ profileName }, async () => {
    await ensureActiveProfileRuntime()
    const returnURL = new URL(input.returnURL)
    const callbackURL = getConnectionCallbackURL(
      input.callbackOrigin,
      input.apiVersion
    )
    const allowedOrigins = new Set([
      new URL(input.callbackOrigin).origin,
      new URL(callbackURL).origin,
      ...CONFIG_MANAGER.getConfig().client_interface.allowed_origins
    ])

    if (!IS_PRODUCTION_ENV) {
      allowedOrigins.add(`${HOST}:${WEB_APP_DEV_SERVER_PORT}`)
    }

    if (
      !['http:', 'https:'].includes(returnURL.protocol) ||
      returnURL.username ||
      returnURL.password ||
      !allowedOrigins.has(returnURL.origin)
    ) {
      throw new Error(
        'The OAuth return URL must belong to an allowed Leon client origin.'
      )
    }

    // A different application ID must be supplied with its own secret.
    const configured = input.clientId
      ? {}
      : await getOAuthClientSettings(input.provider)
    const clientSecret = input.clientId
      ? input.clientSecret
      : configured['client_secret']
    const result = OAUTH_MANAGER.createAuthorization({
      provider: input.provider,
      profileName,
      clientId: input.clientId || configured['client_id'] || '',
      ...(clientSecret ? { clientSecret } : {}),
      redirectUri: callbackURL,
      returnURL: returnURL.toString()
    })

    return { ...result, redirect_uri: callbackURL }
  })
}
