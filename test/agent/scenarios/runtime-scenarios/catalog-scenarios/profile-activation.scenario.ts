import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'

const scenario: RealAgentScenario = {
  async run() {
    const { TOOL_CATALOG } = await import('@/core/tool-manager/catalog/catalog')
    const { TOOLKIT_REGISTRY } = await import('@/core')
    const id = 'communication.gmail'
    const before = (await TOOL_CATALOG.list()).find((entry) => entry.id === id)!
    assert.equal(before.installed, false)
    assert.equal(before.distribution, 'extension')
    assert.equal(before.author?.name, 'Louis Grenard')
    assert.equal(TOOLKIT_REGISTRY.resolveToolById('gmail', 'communication'), null)
    try {
      await TOOL_CATALOG.install({ catalogId: id })
      assert.notEqual(TOOLKIT_REGISTRY.resolveToolById('gmail', 'communication'), null)
      const installed = (await TOOL_CATALOG.list()).find((entry) => entry.id === id)!
      assert.equal(installed.installed, true)
      assert.equal(installed.connected, false)
      await TOOL_CATALOG.act(id, 'disable')
      assert.equal(TOOLKIT_REGISTRY.resolveToolById('gmail', 'communication'), null)

      return { visibleBeforeInstallation: true, installed: true, authorized: false, disabled: true }
    } finally {
      if ((await TOOL_CATALOG.list()).find((entry) => entry.id === id)?.installed) {
        await TOOL_CATALOG.act(id, 'remove')
      }
    }
  }
}

export default scenario
