import fs from 'fs'
import { join } from 'path'

import log from '@/helpers/log'
import domain from '@/helpers/domain'

/**
 * This script delete test DB files if they exist
 */
export default () => new Promise(async (resolve, reject) => {
  log.info('Cleaning test DB files...')

  const [domainKeys, domains] = await Promise.all([domain.list(), domain.getDomainsObj()])

  for (let i = 0; i < domainKeys.length; i += 1) {
    const currentDomain = domains[domainKeys[i]]
    const skillKeys = Object.keys(currentDomain.skills)

    for (let j = 0; j < skillKeys.length; j += 1) {
      const currentSkill = currentDomain.skills[skillKeys[j]]

      try {
        // TODO: handle case where the memory folder contain multiple DB nodes
        const dbFolder = join(currentSkill.path, 'memory')
        const dbTestFiles = fs.readdirSync(dbFolder).filter((entity) => entity.indexOf('.spec.json') !== -1)

        if (dbTestFiles.length > 0) {
          log.info(`Deleting ${dbTestFiles[0]}...`)
          fs.unlinkSync(join(dbFolder, dbTestFiles[0]))
          log.success(`${dbTestFiles[0]} deleted`)
        }
      } catch (e) {
        log.error(`Failed to clean: "${skillKeys[j]}" test DB file`)
        reject(e)
      }
    }
  }

  log.success('Cleaning done')
  resolve()
})
