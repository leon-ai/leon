import assert from 'node:assert/strict'

import type { RealAgentScenario } from '../../../e2e/run-agent-provider-scenario'
import { startMCPFixture } from '../../../../core/fixtures/mcp-server'

const scenario: RealAgentScenario = {
  async run() {
    const { TOOL_CATALOG, getInstalledMCP } = await import('@/core/tool-manager/catalog/catalog')
    const { TOOLKIT_REGISTRY, TOOL_EXECUTOR } = await import('@/core')
    const server = await startMCPFixture()
    let id: string | undefined
    try {
      id = await TOOL_CATALOG.install({ name: 'Scenario workspace', url: server.url })
      assert.equal(server.requests, 0, 'Installing metadata must not contact the provider.')
      const manifest = (await getInstalledMCP(id))!
      await TOOLKIT_REGISTRY.prepareToolkit(manifest.toolkit_id, manifest.tool_id)
      const functions = TOOLKIT_REGISTRY.getToolFunctions(manifest.toolkit_id, manifest.tool_id)!
      const result = await TOOL_EXECUTOR.executeTool({ toolkitId: manifest.toolkit_id, toolId: manifest.tool_id,
        functionName: Object.keys(functions)[0]!, parsedInput: { value: 'Workspace connected' } })
      assert.equal(result.status, 'success')
      assert.deepEqual(result.data.output['result'], { content: [{ type: 'text', text: 'Workspace connected' }],
        structuredContent: { value: 'Workspace connected' } })
      await TOOL_CATALOG.act(id, 'disable')
      assert.equal(TOOLKIT_REGISTRY.resolveToolById(manifest.tool_id, manifest.toolkit_id), null)

      return { installed: true, discovered: Object.keys(functions).length, executed: true, disabled: true }
    } finally {
      if (id) {
        await TOOL_CATALOG.act(id, 'remove')
      }
      await server.close()
    }
  }
}

export default scenario
