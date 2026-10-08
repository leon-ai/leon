import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseDocument } from 'yaml'

const TOOL_MOVES = [
  { toolkit: 'media_production', tool: 'image', sources: ['media_generation'] },
  { toolkit: 'document', tool: 'document', sources: ['media_production', 'media_generation'] },
  { toolkit: 'document', tool: 'typst', sources: ['media_production', 'media_generation'] },
  { toolkit: 'document', tool: 'echarts', sources: ['media_production', 'media_generation'] }
]
const TOOL_IDS = new Map(TOOL_MOVES.flatMap(({ toolkit, tool, sources }) =>
  sources.map((source) => [`${source}.${tool}`, `${toolkit}.${tool}`])
))

/**
 * Publish complete profile files with explicit replacement and permission rules.
 */
async function publishMigratedFile(
  destination,
  content,
  { preserveExisting = false, mode = 0o600 } = {}
) {
  const temporary = `${destination}.${randomUUID()}.tmp`

  try {
    const file = await fs.open(temporary, 'wx', mode)

    try {
      await file.writeFile(content)
      await file.chmod(mode)
      await file.sync()
    } finally {
      await file.close()
    }

    if (preserveExisting) {
      // An exclusive link publishes complete settings without replacing an
      // owner's destination or leaving a partial file after interruption.
      await fs.link(temporary, destination).catch((error) => {
        if (error.code !== 'EEXIST') {
          throw error
        }
      })
    } else {
      await fs.rename(temporary, destination)
    }
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

/**
 * Preserve profile preferences and access restrictions when built-in tools move.
 * Existing destination settings take precedence; source files remain recoverable.
 * @param {import('@/core/profile-runtime/profile-paths').ProfilePaths} profilePaths
 */
export default async function migrate(profilePaths) {
  for (const { toolkit, tool, sources } of TOOL_MOVES) {
    const destination = path.join(profilePaths.tools, toolkit, tool, 'settings.json')

    for (const source of sources) {
      const original = path.join(profilePaths.tools, source, tool, 'settings.json')
      let content

      try {
        content = await fs.readFile(original)
      } catch (error) {
        if (error.code === 'ENOENT') {
          continue
        }

        throw error
      }

      await fs.mkdir(path.dirname(destination), { recursive: true })

      await publishMigratedFile(destination, content, { preserveExisting: true })

      break
    }
  }

  const configPath = profilePaths.config
  let content

  try {
    content = await fs.readFile(configPath, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') {
      return
    }

    throw error
  }

  const config = parseDocument(content)

  if (config.errors.length) {
    throw config.errors[0]
  }

  let changed = false

  for (const list of ['allowed', 'disabled']) {
    const keys = ['availability', 'tools', list]
    const ids = config.getIn(keys)?.toJSON()

    if (Array.isArray(ids)) {
      const updated = [...new Set(ids.map((id) => TOOL_IDS.get(id) || id))]

      if (JSON.stringify(updated) !== JSON.stringify(ids)) {
        config.setIn(keys, updated)
        changed = true
      }
    }
  }

  const satelliteTools = config.getIn(['satellite', 'tools'])?.toJSON()

  for (const [source, destination] of TOOL_IDS) {
    if (satelliteTools && Object.hasOwn(satelliteTools, source)) {
      if (!Object.hasOwn(satelliteTools, destination)) {
        config.setIn(['satellite', 'tools', destination], satelliteTools[source])
        satelliteTools[destination] = satelliteTools[source]
      }

      config.deleteIn(['satellite', 'tools', source])
      changed = true
    }
  }

  if (changed) {
    const configMode = (await fs.stat(configPath)).mode & 0o777

    await publishMigratedFile(configPath, config.toString(), { mode: configMode })
  }
}
