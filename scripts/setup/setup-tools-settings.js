import fs from 'node:fs'
import path from 'node:path'

import { PROFILE_TOOLS_PATH, TOOLS_PATH } from '@/constants'

import { createSetupStatus } from './setup-status'
import { mergeMissingSettings } from './settings-merge'

const TOOL_SETTINGS_SAMPLE_FILENAME = 'settings.sample.json'
const TOOL_SETTINGS_FILENAME = 'settings.json'

function readJSONFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

async function syncToolSettings(toolkitId, toolId, toolPath) {
  const settingsSamplePath = path.join(toolPath, TOOL_SETTINGS_SAMPLE_FILENAME)

  if (!fs.existsSync(settingsSamplePath)) {
    throw new Error(
      `The "${toolkitId}.${toolId}" tool settings sample does not exist.`
    )
  }

  const settingsPath = path.join(
    PROFILE_TOOLS_PATH,
    toolkitId,
    toolId,
    TOOL_SETTINGS_FILENAME
  )
  const settingsSample = readJSONFile(settingsSamplePath)
  const currentSettings = fs.existsSync(settingsPath)
    ? readJSONFile(settingsPath)
    : {}
  const mergedSettings = mergeMissingSettings(settingsSample, currentSettings)

  if (
    fs.existsSync(settingsPath) &&
    JSON.stringify(currentSettings) === JSON.stringify(mergedSettings)
  ) {
    return
  }

  await fs.promises.mkdir(path.dirname(settingsPath), { recursive: true })
  await fs.promises.writeFile(
    settingsPath,
    `${JSON.stringify(mergedSettings, null, 2)}\n`
  )
}

/**
 * Create or update profile settings for built-in tools.
 */
export default async function setupToolsSettings() {
  const status = createSetupStatus('Setting up tool settings...').start()

  try {
    for (const toolkitEntry of fs.readdirSync(TOOLS_PATH, {
      withFileTypes: true
    })) {
      if (!toolkitEntry.isDirectory()) {
        continue
      }

      const toolkitId = toolkitEntry.name
      const toolkitPath = path.join(TOOLS_PATH, toolkitId)
      const toolkitConfigPath = path.join(toolkitPath, 'toolkit.json')

      if (!fs.existsSync(toolkitConfigPath)) {
        continue
      }

      const toolkitConfig = readJSONFile(toolkitConfigPath)

      for (const toolId of toolkitConfig.tools || []) {
        const toolPath = path.join(toolkitPath, toolId)

        if (!fs.existsSync(path.join(toolPath, 'tool.json'))) {
          continue
        }

        await syncToolSettings(toolkitId, toolId, toolPath)
      }
    }

    status.succeed('Tool settings: ready')
  } catch (e) {
    status.fail('Failed to set up tool settings')
    throw e
  }
}
