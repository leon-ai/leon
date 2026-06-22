import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/helpers/log-helper', () => ({
  LogHelper: {
    title: vi.fn(),
    error: vi.fn(),
    warning: vi.fn()
  }
}))

describe('External HTTP plugin loader', () => {
  it('loads plugins from conventional roots and lets profile plugins override global plugins', async () => {
    const { loadExternalHTTPPlugins } = await import(
      '@/core/http-server/http-plugins/loader'
    )
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'leon-http-plugins-')
    )
    const globalPluginsRoot = path.join(tempRoot, 'global')
    const profilePluginsRoot = path.join(tempRoot, 'profile')
    const globalPlugin = path.join(globalPluginsRoot, 'company-agent')
    const profilePlugin = path.join(profilePluginsRoot, 'company-agent')

    await fs.mkdir(globalPlugin, { recursive: true })
    await fs.mkdir(profilePlugin, { recursive: true })
    await fs.writeFile(
      path.join(globalPlugin, 'plugin.yml'),
      [
        'id: company_agent',
        'name: Company Agent',
        'version: 1.0.0',
        'description: Global company integration',
        'entry: index.mjs'
      ].join('\n')
    )
    await fs.writeFile(
      path.join(globalPlugin, 'index.mjs'),
      [
        'export default {',
        '  id: "company-agent",',
        '  name: "Company Agent",',
        '  version: "1.0.0",',
        '  description: "Global company integration",',
        '  register: async () => undefined',
        '}'
      ].join('\n')
    )
    await fs.writeFile(
      path.join(profilePlugin, 'plugin.yml'),
      [
        'id: company_agent',
        'name: Profile Company Agent',
        'version: 2.0.0',
        'description: Profile company integration',
        'entry: index.mjs'
      ].join('\n')
    )
    await fs.writeFile(
      path.join(profilePlugin, 'index.mjs'),
      [
        'export const httpPlugin = {',
        '  id: "company-agent",',
        '  name: "Profile Company Agent",',
        '  version: "2.0.0",',
        '  description: "Profile company integration",',
        '  register: async () => undefined',
        '}'
      ].join('\n')
    )

    const plugins = await loadExternalHTTPPlugins([
      {
        scope: 'global',
        directory: globalPluginsRoot
      },
      {
        scope: 'profile',
        directory: profilePluginsRoot
      }
    ])

    expect(plugins).toHaveLength(1)
    expect(plugins[0]).toMatchObject({
      source: 'profile',
      path: profilePlugin,
      definition: {
        id: 'company-agent',
        name: 'Profile Company Agent',
        version: '2.0.0',
        description: 'Profile company integration'
      }
    })

    await fs.rm(tempRoot, { recursive: true, force: true })
  })
})
