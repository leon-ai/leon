import { commandSync } from 'execa'
import fs from 'fs'
import path from 'path'

import { LOG } from '@/helpers/log'
import { SKILL_DOMAIN } from '@/helpers/skill-domain'

/**
 * Setup skills configuration
 */
export default () =>
  new Promise(async (resolve, reject) => {
    LOG.info('Setting up skills configuration...')

    const skillDomains = await SKILL_DOMAIN.getSkillDomains()

    for (const currentDomain of skillDomains.values()) {
      const skillKeys = Object.keys(currentDomain.skills)

      // Browse skills
      for (let j = 0; j < skillKeys.length; j += 1) {
        const skillFriendlyName = skillKeys[j]
        const currentSkill = currentDomain.skills[skillFriendlyName]
        const configDir = path.join(currentSkill.path, 'src')
        const configFile = path.join(configDir, 'config.json')
        const configSampleFile = path.join(configDir, 'config.sample.json')

        // If there is a bridge set from the skill config
        if (currentSkill.bridge) {
          // Check if the config and config.sample file exist
          if (fs.existsSync(configFile) && fs.existsSync(configSampleFile)) {
            const config = JSON.parse(
              fs.readFileSync(configFile, 'utf8')
            )?.configurations
            const configSample = JSON.parse(
              fs.readFileSync(configSampleFile, 'utf8')
            )?.configurations
            const configKeys = Object.keys(config)
            const configSampleKeys = Object.keys(configSample)

            // Check if there is a new config key in the config sample compared to the config.json
            if (
              JSON.stringify(configKeys) !== JSON.stringify(configSampleKeys)
            ) {
              // Browse config keys of the new skill config
              for (let j = 0; j < configSampleKeys.length; j += 1) {
                // Check if the current config key does not exist
                if (configKeys.includes(configSampleKeys[j]) === false) {
                  LOG.info(
                    `Adding new configuration key "${configSampleKeys[j]}" for the ${skillFriendlyName} skill...`
                  )

                  // Prepare to inject the new config key object
                  const configKey = {
                    [configSampleKeys[j]]: configSample[configSampleKeys[j]]
                  }

                  try {
                    // Add new skill configuration in the config.json file
                    commandSync(
                      `json -I -f ${configFile} -e 'this.configurations.${
                        configSampleKeys[j]
                      }=${JSON.stringify(configKey[configSampleKeys[j]])}'`,
                      { shell: true }
                    )
                    LOG.success(
                      `"${configSampleKeys[j]}" configuration key added to ${configFile}`
                    )
                  } catch (e) {
                    LOG.error(
                      `Error while adding "${configSampleKeys[j]}" configuration key to ${configFile}: ${e}`
                    )
                    reject()
                  }
                }
              }
            }
          } else if (!fs.existsSync(configSampleFile)) {
            // Stop the setup if the config.sample.json of the current skill does not exist
            LOG.error(
              `The "${skillFriendlyName}" skill configuration file does not exist. Try to pull the project (git pull)`
            )
            reject()
          } else {
            // Duplicate config.sample.json of the current skill to config.json
            fs.createReadStream(configSampleFile).pipe(
              fs.createWriteStream(`${configDir}/config.json`)
            )

            LOG.success(
              `"${skillFriendlyName}" skill configuration file created`
            )
            resolve()
          }
        }
      }
    }

    LOG.success('Skills configured')
    resolve()
  })
