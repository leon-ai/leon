import fs from 'node:fs'
import { join } from 'node:path'

import { LogHelper } from '@/helpers/log-helper'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'

/**
 * This script delete test DB files if they exist
 */
export default () =>
  new Promise(async (resolve, reject) => {
    LogHelper.info('Cleaning test DB files...')

    const skillDomains = await SkillDomainHelper.getSkillDomains()

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
            LogHelper.info(`Deleting ${dbTestFiles[0]}...`)
            fs.unlinkSync(join(dbFolder, dbTestFiles[0]))
            LogHelper.success(`${dbTestFiles[0]} deleted`)
          }
        } catch (e) {
          LogHelper.error(`Failed to clean: "${skillKeys[j]}" test DB file`)
          reject(e)
        }
      }
    }

    LogHelper.success('Cleaning done')
    resolve()
  })
