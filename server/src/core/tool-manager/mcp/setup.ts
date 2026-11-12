import type { ConnectionSetupInput } from '@/core/connections/connection-setup'
import {
  ConnectionSetupActionId as Action, ConnectionSetupStep as Step,
  CONNECTION_SETUP_MESSAGES, type ConnectionSetupResult
} from '@@/aurora/src/contracts/connection-setup'
import { getConnectionCallbackURL } from '@/core/connections/connection-catalog'
import { ProfileHelper } from '@/helpers/profile-helper'
import { TOOLKIT_REGISTRY } from '@/core'
import { getInstalledMCP, TOOL_CATALOG } from '../catalog/catalog'
import { MCP_MANAGER, startMCPOAuth } from './manager'
import { MCP_CONNECTIONS } from './auth'
import { getMCPURL } from './http'
import { FileHelper } from '@/helpers/file-helper'
import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import { resolveToolDirectory } from '@/leon-roots'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { MCPManifest, MCPSource } from '../tool-source'

/**
 * Public OAuth application identifiers belong to the profile manifest, not chat
 * or a second settings store. Changing them revokes the incompatible old grant.
 */
async function configureApplication(manifest: MCPManifest, values: Record<string, string>): Promise<MCPManifest> {
  const clientId = values['client_id']?.trim() ?? ''
  const metadata = values['client_metadata_url']?.trim() ?? ''
  if (Object.keys(values).some((key) => !['client_id', 'client_metadata_url'].includes(key)) || clientId.length > 256) {
    throw new Error('Only public OAuth application settings are supported here.')
  }
  const clientMetadataUrl = metadata ? getMCPURL(metadata).toString() : undefined
  if (clientMetadataUrl && new URL(clientMetadataUrl).protocol !== 'https:') {
    throw new Error('Client metadata documents require HTTPS.')
  }
  const source: MCPSource = { type: 'mcp', transport: 'http', url: manifest.source.url,
    ...(clientId ? { clientId } : {}), ...(clientMetadataUrl ? { clientMetadataUrl } : {}) }

  return TOOL_CATALOG.change(async () => {
    const id = `${manifest.toolkit_id}.${manifest.tool_id}`
    const current = await getInstalledMCP(id)
    if (!current || JSON.stringify(current.source) !== JSON.stringify(manifest.source)) {
      throw new Error('This installation changed. Open connection setup again.')
    }
    if (JSON.stringify(source) === JSON.stringify(current.source)) {
      return current
    }
    const directory = resolveToolDirectory(getProfilePaths().tools, manifest.toolkit_id, manifest.tool_id)
    await MCP_MANAGER.close(id)
    await MCP_CONNECTIONS.remove(id)
    const updated = { ...current, source }
    await FileHelper.writeAtomicJSON(path.join(directory, 'tool.json'), updated)
    await fs.unlink(path.join(directory, '.mcp-tools.json')).catch(() => undefined)
    await TOOLKIT_REGISTRY.reload()
    await MCP_MANAGER.close(id)

    return updated
  })
}

/**
 * Keeps MCP account setup in the same trusted widget as native accounts. A
 * remote server cannot replace this UI or receive credentials through chat.
 */
export async function setupMCPConnection(input: ConnectionSetupInput): Promise<ConnectionSetupResult | undefined> {
  let manifest = await getInstalledMCP(input.provider)
  if (!manifest) {
    return undefined
  }
  const enabled = !ProfileHelper.isToolDisabled(manifest.tool_id, manifest.toolkit_id)
  if (![Action.Refresh, Action.Credentials, Action.SelectMethod, Action.Connect, Action.Continue].includes(input.action as Action)) {
    throw new Error('Unknown connection action.')
  }
  if (input.authorization_failed) {
    await MCP_MANAGER.close(input.provider)
  }
  let authorization: { authorization_url?: string } = {}
  // Returning to sign-in changes only the screen; application settings are
  // persisted exclusively by an explicit Connect submission.
  const configuring = input.action !== Action.SelectMethod &&
    (input.action === Action.Credentials || input.state?.step === Step.Credentials)
  if (input.action === Action.Connect) {
    if (!enabled) {
      throw new Error('Enable this tool before connecting it.')
    }
    if (configuring) {
      manifest = await configureApplication(manifest, input.credentials ?? {})
    }
    authorization = await startMCPOAuth(manifest, input.callback_origin,
      input.return_url ?? `${input.callback_origin}/api/${input.api_version}/connections/complete`, input.api_version)
    await TOOLKIT_REGISTRY.reload()
  }
  const entry = (await TOOL_CATALOG.list()).find((entry) => entry.id === input.provider)!
  const continued = input.action === Action.Continue && entry.connected && Boolean(input.session_id)
  if (input.action === Action.Continue && !continued) {
    throw new Error('Connect this account before continuing in a conversation.')
  }

  return { ...authorization,
    ...(continued ? { event: { methodName: 'send_utterance', session_id: input.session_id,
      methodParams: { from: 'owner' as const, utterance: 'Continue.' } } } : {}),
    view: {
    tool: { name: manifest.name, description: manifest.description },
    title: manifest.name, description: entry.connected ? 'Your MCP connection is ready.'
      : 'Sign in on the provider’s website to choose what I can access.',
    state: { method: 'oauth', step: continued ? Step.Continued : entry.connected ? Step.Connected : configuring ? Step.Credentials : Step.Choice },
    ...(entry.connected ? { status: 'Connected' } : {}),
    ...(!enabled ? { notice: 'Enable this tool in Settings → Tools and connections before signing in.' } :
      input.authorization_failed ? { notice: 'Sign-in was cancelled or could not finish. You can try again.' } : {}),
    fields: configuring && !entry.connected ? [
      { name: 'client_id', label: 'Client ID', type: 'text', required: false, value: manifest.source.clientId ?? '', maxLength: 256 },
      { name: 'client_metadata_url', label: 'Client metadata URL', type: 'text', required: false, value: manifest.source.clientMetadataUrl ?? '', maxLength: 2_048 }
    ] : [], links: [],
    ...(configuring && !entry.connected ? { details: { label: 'Connection details', instructions: [
      'Use a public OAuth application with the redirect URI below. Client secrets are not supported by this flow.',
      'Enter its client ID or HTTPS client metadata URL only if the server requires it. Leave both empty for automatic registration.',
      'Changing application settings clears the previous authorization before starting a new sign-in.'
    ], values: [
      { label: 'MCP server', value: manifest.source.url, copyLabel: 'Copy server URL' },
      { label: 'Redirect URI', value: getConnectionCallbackURL(input.callback_origin, input.api_version, 'tools'), copyLabel: 'Copy redirect URI' }
    ] } } : {}),
    actions: entry.connected ? input.session_id && !continued ? [{ id: Action.Continue, label: 'Continue' }] : [] :
      !enabled ? [] : [{ id: Action.Connect, label: `Connect ${manifest.name}`, ...(configuring ? { submit: true } : {}) },
        { id: configuring ? Action.SelectMethod : Action.Credentials,
          label: configuring ? 'Back' : 'Display OAuth settings', secondary: true }],
    messages: CONNECTION_SETUP_MESSAGES
  } }
}
