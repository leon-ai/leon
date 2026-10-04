import fs from 'node:fs/promises'

import { expect, it } from 'vitest'

import { createCuaDriverAdapter } from '@@/tools/computer_use/cua/src/nodejs/lib/cua/cua-driver-adapter'
import { CuaDesktopSetupState } from '@@/tools/computer_use/cua/src/nodejs/lib/cua/cua-desktop-setup'

it('keeps native Cua action arguments compatible with the installed driver', async () => {
  const manifest = JSON.parse(
    await fs.readFile('tools/computer_use/cua/tool.json', 'utf8')
  )
  const driver = await createCuaDriverAdapter({
    toolkitId: 'computer_use',
    toolId: 'cua',
    functionName: 'health_report',
    parameters: {}
  }, { ensure: async () => CuaDesktopSetupState.Ready } as never)

  try {
    // Catalog inspection sends no desktop input and needs no OS grants.
    const catalog = JSON.parse(await driver.listToolsJson())
    const hostParameters: Record<string, string[]> = {
      list_apps: ['query'],
      get_window_state: ['settle_ms'],
      get_desktop_state: ['settle_ms'],
      zoom: ['purpose', 'scope'],
      move_cursor: ['capture_after', 'settle_ms'],
      click: ['capture_after', 'settle_ms'],
      drag: ['capture_after', 'settle_ms'],
      scroll: ['capture_after', 'settle_ms'],
      type_text: ['capture_after', 'settle_ms', 'mode', 'method'],
      press_key: ['capture_after', 'settle_ms'],
      hotkey: ['capture_after', 'settle_ms']
    }
    for (const name of Object.keys(manifest.functions)) {
      if (name === 'perform_actions' || name === 'copy_text') {
        continue
      }

      const definition = manifest.functions[name]
      const localParameters = hostParameters[name] ?? []
      const native = catalog.tools.find(
        (tool: { name: string }) => tool.name === name
      )
      expect(native, name).toBeDefined()
      for (const parameter of Object.keys(definition.parameters.properties)) {
        if (!localParameters.includes(parameter)) {
          expect(native.inputSchema.properties, `${name}.${parameter}`)
            .toHaveProperty(parameter)
        }
      }

      const token = definition.parameters.properties.element_token
      if (token) {
        expect(token.pattern, `${name}.element_token.pattern`)
          .toBe(native.inputSchema.properties.element_token.pattern)
      }
    }
    expect(manifest.functions.click.parameters.properties).not.toHaveProperty('element_index')
    expect(manifest.functions.click.parameters.properties).not.toHaveProperty('snapshot_id')
    const zoom = catalog.tools.find((tool: { name: string }) => tool.name === 'zoom')
    expect(zoom.inputSchema.properties).toHaveProperty('session')
    const click = catalog.tools.find((tool: { name: string }) => tool.name === 'click')
    const batchToken = manifest.functions.perform_actions.parameters.properties
      .steps.items.properties.parameters.properties.element_token
    expect(batchToken.pattern).toBe(click.inputSchema.properties.element_token.pattern)
  } finally {
    await driver.shutdown()
    driver.uniffiDestroy()
  }
})
