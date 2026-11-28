import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Keep Grok available in profiles with an existing API key.
 */
export default async function migrate(profilePaths) {
  const directory = path.join(profilePaths.tools, 'search_web', 'grok')
  const receipt = path.join(directory, '.installation.json')
  if (await fs.access(receipt).then(() => true, () => false)) {
    return
  }

  const settings = await fs.readFile(path.join(directory, 'settings.json'), 'utf8')
    .then(JSON.parse).catch((error) => {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) {
        return null
      }
      throw error
    })

  if (typeof settings?.GROK_API_KEY !== 'string' || !settings.GROK_API_KEY.trim()) {
    return
  }

  const temporary = `${receipt}.tmp`
  await fs.writeFile(temporary, '{"installed":true}\n', { mode: 0o600 })
  await fs.rename(temporary, receipt)
}
