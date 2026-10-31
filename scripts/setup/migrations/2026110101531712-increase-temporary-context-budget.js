import fs from 'node:fs/promises'
import path from 'node:path'

const PREVIOUS_DEFAULT_BUDGET = 600
const DEFAULT_BUDGET = 4_096

/**
 * Give existing profiles room for concurrent circumstances while preserving
 * owner-customized budgets and other memory settings.
 */
export default async function migrate(profilePaths) {
  const settingsPath = path.join(
    profilePaths.tools, 'structured_knowledge', 'memory', 'settings.json'
  )
  let settings

  try {
    settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') {
      return
    }

    throw error
  }

  if (settings.temporaryContext?.tokenBudget !== PREVIOUS_DEFAULT_BUDGET) {
    return
  }

  settings.temporaryContext.tokenBudget = DEFAULT_BUDGET

  // Publish a complete file so interrupted setup can safely retry.
  const temporaryPath = `${settingsPath}.tmp`
  const mode = (await fs.stat(settingsPath)).mode & 0o777
  await fs.writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, { mode })
  await fs.rename(temporaryPath, settingsPath)
}
