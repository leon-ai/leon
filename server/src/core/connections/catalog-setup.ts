import {
  ConnectionSetupActionId as Action, ConnectionSetupStep as Step,
  CONNECTION_SETUP_MESSAGES, type ConnectionSetupResult
} from '@@/aurora/src/contracts/connection-setup'
import { TOOL_CATALOG, isCatalogToolRestricted } from '@/core/tool-manager/catalog/catalog'
import type { ConnectionSetupInput } from './connection-setup'

/**
 * Gates setup on explicit owner activation. Refresh and model lookup remain
 * read-only, and stale cards are rebuilt from the profile's current catalog.
 */
export async function prepareCatalogConnection(
  input: ConnectionSetupInput
): Promise<ConnectionSetupResult | undefined> {
  let entry = (await TOOL_CATALOG.list({ presentation: false })).find((tool) => tool.id === input.provider)
  if (!entry) {
    throw new Error('This tool is no longer available.')
  }

  const restricted = isCatalogToolRestricted(entry)
  if (restricted && (input.action === Action.Install || input.action === Action.Enable)) {
    throw new Error('This profile’s allow-only list does not permit this tool.')
  }
  if (input.action === Action.Install && !entry.installed) {
    await TOOL_CATALOG.install({ catalogId: entry.id })
    entry = (await TOOL_CATALOG.list({ presentation: false })).find((tool) => tool.id === input.provider)!
  }
  if (input.action === Action.Enable && entry.installed && !entry.enabled) {
    await TOOL_CATALOG.act(entry.id, 'enable')
    entry = (await TOOL_CATALOG.list({ presentation: false })).find((tool) => tool.id === input.provider)!
  }
  if (!entry) {
    throw new Error('This tool is no longer available.')
  }

  const activationNeeded = !entry.installed || !entry.enabled
  if (!activationNeeded && entry.canConnect) {
    return undefined
  }
  if (activationNeeded && ![Action.Refresh, Action.Install, Action.Enable].includes(input.action as Action)) {
    throw new Error('Add and enable this tool before connecting it.')
  }

  const continued = input.action === Action.Continue && Boolean(input.session_id) && !activationNeeded
  if (input.action === Action.Continue && !continued) {
    throw new Error('Add and enable this tool before continuing in a conversation.')
  }

  return {
    ...(continued ? {
      event: {
        methodName: 'send_utterance' as const,
        session_id: input.session_id,
        methodParams: { from: 'owner' as const, utterance: 'Continue.' }
      }
    } : {}),
    view: {
      title: entry.name,
      state: {
        method: 'catalog',
        step: !entry.installed ? Step.Installation
          : !entry.enabled ? Step.Disabled : continued ? Step.Continued : Step.Connected
      },
      description: !entry.installed ? `${entry.name} is in my catalog, but hasn’t been added to this profile.`
        : !entry.enabled ? `${entry.name} is added but currently disabled.` : `${entry.name} is ready to use.`,
      ...(restricted ? { notice: 'This profile uses an allow-only list. Update it with /tool to permit this tool.' }
        : !entry.installed ? { notice: entry.canConnect
          ? 'Adding makes its tools available. Account access still requires a separate connection.'
          : 'Adding makes its tools available in this profile.' } : {}),
      fields: [], links: [], messages: CONNECTION_SETUP_MESSAGES,
      actions: restricted ? [] : !entry.installed ? [{ id: Action.Install, label: `Add ${entry.name}` }]
        : !entry.enabled ? [{ id: Action.Enable, label: `Enable ${entry.name}` }]
          : input.session_id && !continued ? [{ id: Action.Continue, label: 'Continue' }] : []
    }
  }
}
