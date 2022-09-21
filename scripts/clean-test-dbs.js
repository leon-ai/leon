import fs from 'fs'
import { join } from 'path'

import { LOG } from '@/helpers/log'
import { SKILL_DOMAIN } from '@/helpers/skill-domain'

/**
 * This script delete test DB files if they exist
 */
export default () =>
  new Promise(async (resolve, reject) => {
    LOG.info('Cleaning test DB files...')

    const skillDomains = await SKILL_DOMAIN.getSkillDomains()

    for (const currentDomain of skillDomains.values()) {
      const skillKeys = Object.keys(currentDomain.skills)

      for (let j = 0; j < skillKeys.length; j += 1) {
        const currentSkill = currentDomain.skills[skillKeys[j]]

        try {
          // TODO: handle case where the memory folder contain multiple DB nodes
          const dbFolder = join(currentSkill.path, 'memory')
          const dbTestFiles = fs
            .readdirSync(dbFolder)
            .filter((entity) => entity.indexOf('.spec.json') !== -1)

          if (dbTestFiles.length > 0) {
            LOG.info(`Deleting ${dbTestFiles[0]}...`)
            fs.unlinkSync(join(dbFolder, dbTestFiles[0]))
            LOG.success(`${dbTestFiles[0]} deleted`)
          }
        } catch (e) {
          LOG.error(`Failed to clean: "${skillKeys[j]}" test DB file`)
          reject(e)
        }
      }
    }

    LOG.success('Cleaning done')
    resolve()
  })
