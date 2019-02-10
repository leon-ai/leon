import { shellSync } from 'execa'
import fs from 'fs'
import path from 'path'

import log from '@/helpers/log'
import string from '@/helpers/string'

/**
 * Setup packages configuration
 */
export default () => new Promise((resolve, reject) => {
  log.info('Setting-up packages configuration...')

  const packagesDir = 'packages'
  // Get packages list
  const packages = fs.readdirSync(packagesDir)
    .filter(entity =>
      fs.statSync(path.join(packagesDir, entity)).isDirectory())

  // Browse packages
  for (let i = 0; i < packages.length; i += 1) {
    const configDir = `${packagesDir}/${packages[i]}/config`
    const configFile = `${configDir}/config.json`
    const configSampleFile = `${configDir}/config.sample.json`

    // Check if the config and config.sample file exist
    if (fs.existsSync(configFile) && fs.existsSync(configSampleFile)) {
      const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
      const configSample = JSON.parse(fs.readFileSync(configSampleFile, 'utf8'))
      const configModules = Object.keys(config)
      const configSampleModules = Object.keys(configSample)

      // Check if there is a new module in the config sample compare to the current config.json
      if (JSON.stringify(configModules) !== JSON.stringify(configSampleModules)) {
        // Browse modules of the current package
        for (let j = 0; j < configSampleModules.length; j += 1) {
          // Check if the current module does not exist
          if (configModules.includes(configSampleModules[j]) === false) {
            log.info(`Adding new module "${string.ucfirst(configSampleModules[j])}" configuration...`)

            // Prepare to inject the new module config object
            const module = { }
            module[configSampleModules[j]] = configSample[configSampleModules[j]]

            try {
              // Add new module configuration in the config.json file
              shellSync(`json -I -f ${configFile} -e 'this.${configSampleModules[j]}=${JSON.stringify(module[configSampleModules[j]])}'`)
              log.success(`"${string.ucfirst(configSampleModules[j])}" module configuration added to ${configFile}`)
            } catch (e) {
              log.error(`Error while adding "${string.ucfirst(configSampleModules[j])}" module configuration to ${configFile}: ${e}`)
              reject()
            }
          }
        }
      }
    } else if (!fs.existsSync(configSampleFile)) {
      // Stop the setup if the config.sample.json of the current package does not exist
      log.error(`The "${string.ucfirst(packages[i])}" package configuration file does not exist. Try to pull the project (git pull)`)
      reject()
    } else {
      // Duplicate config.sample.json of the current package to config.json
      fs.createReadStream(configSampleFile)
        .pipe(fs.createWriteStream(`${configDir}/config.json`))

      log.success(`"${string.ucfirst(packages[i])}" package configuration file created`)
      resolve()
    }
  }

  log.success('Packages configured')
  resolve()
})
