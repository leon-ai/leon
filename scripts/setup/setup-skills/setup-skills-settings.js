import fs from 'node:fs'
import path from 'node:path'

import { PROFILE_SKILLS_PATH } from '@/constants'

/**
 * Set up skills settings
 */
export default async function (skillFriendlyName, currentSkill) {
  const skillName = path.basename(currentSkill.path)
  const skillSrcPath = path.join(currentSkill.path, 'src')
  const settingsPath = path.join(
    PROFILE_SKILLS_PATH,
    skillName,
    'settings.json'
  )
  const settingsSamplePath = path.join(skillSrcPath, 'settings.sample.json')

  // If there is a bridge set from the skill settings
  if (currentSkill.bridge) {
    // Check if the settings and settings.sample file exist
    if (fs.existsSync(settingsPath) && fs.existsSync(settingsSamplePath)) {
      const settings = JSON.parse(
        await fs.promises.readFile(settingsPath, 'utf8')
      )
      const settingsSample = JSON.parse(
        await fs.promises.readFile(settingsSamplePath, 'utf8')
      )
      const settingsKeys = Object.keys(settings)
      const settingsSampleKeys = Object.keys(settingsSample)

      // Check if there is a new settings key in the settings sample compared to the settings.json
      if (JSON.stringify(settingsKeys) !== JSON.stringify(settingsSampleKeys)) {
        // Browse settings keys of the new settings config
        for (let j = 0; j < settingsSampleKeys.length; j += 1) {
          // Check if the current settings key does not exist
          if (!settingsKeys.includes(settingsSampleKeys[j])) {
            // Prepare to inject the new settings key object
            const configKey = {
              [settingsSampleKeys[j]]: settingsSample[settingsSampleKeys[j]]
            }

            try {
              settings[settingsSampleKeys[j]] = configKey[settingsSampleKeys[j]]
            } catch (e) {
              throw new Error(
                `Error while adding "${settingsSampleKeys[j]}" settings key to ${settingsPath}: ${e}`
              )
            }
          }
        }

        await fs.promises.mkdir(path.dirname(settingsPath), { recursive: true })
        await fs.promises.writeFile(
          settingsPath,
          `${JSON.stringify(settings, null, 2)}\n`
        )
      }
    } else if (!fs.existsSync(settingsSamplePath)) {
      // Stop the setup if the settings.sample.json of the current skill does not exist
      throw new Error(
        `The "${skillFriendlyName}" skill settings file does not exist. Try to pull the project (git pull)`
      )
    } else {
      // Duplicate settings.sample.json of the current skill to settings.json
      await fs.promises.mkdir(path.dirname(settingsPath), { recursive: true })
      await fs.promises.copyFile(settingsSamplePath, settingsPath)
    }
  }
}
