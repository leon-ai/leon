import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const EXTENSIONS = [
  ['communication', 'gmail'],
  ['music_audio', 'spotify'],
  ['productivity_collaboration', 'ticktick']
]

/**
 * Preserve configured extensions that previously shipped as built-ins.
 * Keep the inventory fixed so later extensions use their own activation rules.
 */
export default async function migrate(profilePaths) {
  const toolsRoot = fileURLToPath(new URL('../../../tools/', import.meta.url))

  for (const [toolkitId, toolId] of EXTENSIONS) {
    const manifest = await fs.readFile(path.join(toolsRoot, toolkitId, toolId, 'tool.json'), 'utf8')
      .then(JSON.parse).catch(() => undefined)
    if (manifest?.distribution !== 'extension' || manifest.source) {
      continue
    }

    const directory = path.join(profilePaths.tools, toolkitId, toolId)
    const receipt = path.join(directory, '.installation.json')
    if (await fs.access(receipt).then(() => true, () => false)) {
      continue
    }

    const settings = await fs.readFile(path.join(directory, 'settings.json'), 'utf8')
      .then(JSON.parse).catch(() => ({}))
    const configured = Object.values(settings).some((value) => value !== null && value !== '')
    const connected = await fs.access(path.join(profilePaths.connections, `${toolkitId}.${toolId}.json`))
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
