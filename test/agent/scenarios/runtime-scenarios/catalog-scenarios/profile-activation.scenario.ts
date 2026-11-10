import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'

const scenario: RealAgentScenario = {
  async run() {
    const { TOOL_CATALOG } = await import('@/core/tool-manager/catalog/catalog')
    const { TOOLKIT_REGISTRY, SOCKET_SERVER } = await import('@/core')
    const { searchAgentCatalog } = await import('@/core/tool-manager/catalog/agent-catalog')
    const { handleConnectionSetup } = await import('@/core/connections/connection-setup')
    const { ConnectionSetupActionId: Action, ConnectionSetupStep: Step } = await import('@@/aurora/src/contracts/connection-setup')
    const id = 'communication.gmail'
    const before = (await TOOL_CATALOG.list()).find((entry) => entry.id === id)!
    assert.equal(before.installed, false)
    assert.equal(before.distribution, 'extension')
    assert.equal(before.author?.name, 'Louis Grenard')
    assert.equal(TOOLKIT_REGISTRY.resolveToolById('gmail', 'communication'), null)
    const emit = SOCKET_SERVER.emitAnswerToChatClients
    let widget: unknown
    SOCKET_SERVER.emitAnswerToChatClients = (value): void => {
      widget = value
    }
    try {
      const found = JSON.parse(await searchAgentCatalog({ query: 'Gmail' }))
      assert.equal(found.tools[0].state, 'not_added')
      assert.equal(found.setup_card, id)
      assert.equal((widget as { widget: string }).widget, 'ConnectionWidget')
      const input = { provider: id, session_id: '', callback_origin: 'http://127.0.0.1:1337', api_version: 'v1', action: Action.Refresh }
      assert.equal((await handleConnectionSetup(input)).view.state.step, Step.Installation)
      assert.equal((await TOOL_CATALOG.list()).find((entry) => entry.id === id)!.installed, false)
      const added = await handleConnectionSetup({ ...input, action: Action.Install })
      assert.equal(added.authorization_url, undefined)
      assert.equal(added.event, undefined)
      assert.notEqual(TOOLKIT_REGISTRY.resolveToolById('gmail', 'communication'), null)
      const installed = (await TOOL_CATALOG.list()).find((entry) => entry.id === id)!
      assert.equal(installed.installed, true)
      assert.equal(installed.connected, false)
      await TOOL_CATALOG.act(id, 'disable')
      assert.equal(TOOLKIT_REGISTRY.resolveToolById('gmail', 'communication'), null)

      return { visibleBeforeInstallation: true, readOnlyLookup: true, ownerActivated: true, authorized: false, disabled: true }
    } finally {
      SOCKET_SERVER.emitAnswerToChatClients = emit
      if ((await TOOL_CATALOG.list()).find((entry) => entry.id === id)?.installed) {
        await TOOL_CATALOG.act(id, 'remove')
      }
    }
  }
}

export default scenario
