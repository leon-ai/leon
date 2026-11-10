import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Preserve previously configured native integrations while keeping unconfigured
 * extension suggestions inactive. Never reinterpret REST tokens as MCP grants.
 */
export default async function migrate(profilePaths) {
  const toolsRoot = fileURLToPath(new URL('../../../tools/', import.meta.url))
  for (const toolkit of await fs.readdir(toolsRoot, { withFileTypes: true })) {
    if (!toolkit.isDirectory()) {
      continue
    }
    for (const tool of await fs.readdir(path.join(toolsRoot, toolkit.name), { withFileTypes: true })) {
      if (!tool.isDirectory()) {
        continue
      }
      const manifest = await fs.readFile(path.join(toolsRoot, toolkit.name, tool.name, 'tool.json'), 'utf8')
        .then(JSON.parse).catch(() => undefined)
      if (manifest?.distribution !== 'extension' || manifest.source) {
        continue
      }
      const directory = path.join(profilePaths.tools, toolkit.name, tool.name)
      const receipt = path.join(directory, '.installation.json')
      if (await fs.access(receipt).then(() => true, () => false)) {
        continue
      }
      const settings = await fs.readFile(path.join(directory, 'settings.json'), 'utf8')
        .then(JSON.parse).catch(() => ({}))
      const configured = Object.values(settings).some((value) => value !== null && value !== '')
      const connected = await fs.access(path.join(profilePaths.connections, `${toolkit.name}.${tool.name}.json`))
        .then(() => true, () => false)
      if (!configured && !connected) {
        continue
      }
      await fs.mkdir(directory, { recursive: true, mode: 0o700 })
      const temporary = `${receipt}.tmp`
      await fs.writeFile(temporary, `${JSON.stringify({ installed: true })}\n`, { mode: 0o600 })
      await fs.rename(temporary, receipt)
    }
  }
}
