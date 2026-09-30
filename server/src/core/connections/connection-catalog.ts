import { ToolkitConfig } from '@sdk/toolkit-config'
import { getActiveProfileName } from '@/core/profile-runtime/profile-context'
import { CONFIG_MANAGER } from '@/config'
import { TOOLKIT_REGISTRY } from '@/core'
import { OAUTH_APPLICATION_STORE } from './connection-store'

/**
 * Limits runtime credentials to the fields declared by the tool.
 */
export function getToolCredentials(
  provider: string,
  credentials: Record<string, unknown>
): Record<string, unknown> {
  const tool = TOOLKIT_REGISTRY.getConnectionTool(provider)

  return Object.fromEntries(
    tool.connection.required_settings.map((key) => [key, credentials[key]])
  )
}

/**
 * Reads legacy settings without reflecting parser errors containing secrets.
 */
function getLegacyOAuthClientSettings(
  provider: string
): Record<string, string> {
  const tool = TOOLKIT_REGISTRY.getConnectionTool(provider)
  const method = tool.connection.methods.oauth

  if (!method) {
    return {}
  }

  let settings: Record<string, unknown>

  try {
    settings = ToolkitConfig.loadToolSettings(
      tool.toolkit_id,
      tool.tool_id,
      {},
      true,
      getActiveProfileName()
    )
  } catch {
    // JSON parser errors may contain fragments of a malformed secret value.
    throw new Error(
      `Unable to read OAuth application settings for ${provider}.`
    )
  }

  return Object.fromEntries(
    Object.keys(method.settings).map((key) => [
      key,
      typeof settings[key] === 'string' ? settings[key] : ''
    ])
  )
}

/**
 * Migrates legacy application credentials only after verifying encrypted storage.
 */
export async function getOAuthClientSettings(
  provider: string
): Promise<Record<string, string>> {
  const tool = TOOLKIT_REGISTRY.getConnectionTool(provider)
  const method = tool.connection.methods.oauth
  if (!method) {
    return {}
  }

  const legacy = getLegacyOAuthClientSettings(provider)
  const stored = await OAUTH_APPLICATION_STORE.getCredentials(provider)
  const credentials = stored || legacy
  if (!stored && Object.values(legacy).some(Boolean)) {
    await OAUTH_APPLICATION_STORE.save({
      provider, auth_type: 'oauth', credentials: legacy
    })
  }

  if (Object.values(legacy).some(Boolean)) {
    const verified = await OAUTH_APPLICATION_STORE.getCredentials(provider)
    if (!verified || Object.entries(credentials).some(([key, value]) => verified[key] !== value)) {
      throw new Error('Unable to verify encrypted application credentials.')
    }
    // Keep unrelated configuration and remove plaintext only after read-back.
    try {
      ToolkitConfig.saveToolSettings(tool.toolkit_id, tool.tool_id,
        Object.fromEntries(Object.keys(method.settings).map((key) => [key, null])),
        getActiveProfileName())
    } catch {
      throw new Error('Application credentials are encrypted, but legacy settings could not be cleared.')
    }
  }

  return Object.fromEntries(Object.entries(credentials).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string'
  ))
}

/**
 * Uses an explicit public URL behind proxies without trusting forwarded headers.
 */
export function getConnectionCallbackURL(
  origin: string,
  apiVersion: string
): string {
  const publicURL = CONFIG_MANAGER.getConfig().server.public_url || origin
  const base = new URL(publicURL)

  if (!base.pathname.endsWith('/')) {
    base.pathname += '/'
  }

  const url = new URL(`api/${apiVersion}/connections/oauth/callback`, base)

  // Numeric loopback addresses work with providers that reject localhost redirects.
  if (url.hostname === 'localhost') {
    url.hostname = '127.0.0.1'
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      'The OAuth callback must use an HTTP or HTTPS URL without credentials.'
    )
  }

  return url.toString()
}

/**
 * Exposes tool-owned setup metadata; configured client secrets never leave Core.
 */
async function getConnectionSetup(
  provider: string,
  callback?: { origin: string, apiVersion: string, setup_values?: Record<string, string> }
): Promise<{
  tool_id: string
  toolkit_id: string
  name: string
  description: string
  icon_name: string | undefined
  methods: Array<{
    id: string
    name: string
    description: string
    setup_url: string
    setup?: { instructions: string[], values: Record<string, string> }
    settings: Record<string, string | null>
    redirect_uri?: string
  }>
}> {
  const tool = TOOLKIT_REGISTRY.getConnectionTool(provider)

  return {
    tool_id: tool.tool_id,
    toolkit_id: tool.toolkit_id,
    name: tool.name,
    description: tool.description,
    icon_name: tool.icon_name,
    methods: await Promise.all(Object.entries(tool.connection.methods).map(async ([id, method]) => {
      const configured =
        id === 'oauth'
          ? await getOAuthClientSettings(`${tool.toolkit_id}.${tool.tool_id}`)
          : {}
      const hasClient = Object.entries(method.settings).every(
        ([key, fallback]) => fallback !== null || Boolean(configured[key])
      )

      return {
        id,
        name: method.name,
        description: method.description,
        setup_url: method.setup_url,
        ...(method.setup
          ? {
              setup: {
                ...method.setup,
                // Hosts may brand declared display values, never credential
                // fields, authorization endpoints or the computed callback.
                values: Object.fromEntries(
                  Object.entries(method.setup.values).map(([key, value]) => [
                    key,
                    typeof callback?.setup_values?.[key] === 'string'
                      ? callback.setup_values[key]
                      : value
                  ])
                )
              }
            }
          : {}),
        settings: hasClient ? {} : method.settings,
        ...(id === 'oauth' && callback
          ? {
              redirect_uri: getConnectionCallbackURL(
                callback.origin,
                callback.apiVersion
              )
            }
          : {})
      }
    }))
  }
}

/**
 * Exposes the same tool-owned setup metadata to every connection client.
 */
export async function getConnectionCatalog(callback?: {
  origin: string
  apiVersion: string
  setup_values?: Record<string, string>
}): Promise<Array<Awaited<ReturnType<typeof getConnectionSetup>>>> {
  return Promise.all(TOOLKIT_REGISTRY.getConnectionTools().map((tool) =>
    getConnectionSetup(`${tool.toolkit_id}.${tool.tool_id}`, callback)
  ))
}

/**
 * Gives the agent current setup facts without configured credentials or tokens.
 */
export async function getConnectionRequirements(
  providers: string[]
): Promise<Array<Record<string, unknown>>> {
  return Promise.all([...new Set(providers)].map(async (provider) => {
    try {
      const tool = await getConnectionSetup(provider)

      return {
        provider,
        name: tool.name,
        connected: !TOOLKIT_REGISTRY.needsToolConnection(
          tool.toolkit_id,
          tool.tool_id
        ),
        methods: tool.methods.map(({ settings, ...method }) => ({
          ...method,
          required_fields: Object.keys(settings)
        }))
      }
    } catch {
      // A removed tool or malformed settings must not discard the paused task.
      return { provider, setup_unavailable: true }
    }
  }))
}
