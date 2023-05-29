import { LogHelper } from '@/helpers/log-helper'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'

import setupSkillsSettings from './setup-skills-settings'
import installNodejsSkillsPackages from './install-nodejs-skills-packages'

/**
 * Browse skills and set them up
 */
export default async function () {
  LogHelper.info('Setting up skills...')

  try {
    const skillDomains = await SkillDomainHelper.getSkillDomains()

    for (const currentDomain of skillDomains.values()) {
      const skillKeys = Object.keys(currentDomain.skills)

      // Browse skills
      for (let i = 0; i < skillKeys.length; i += 1) {
        const skillFriendlyName = skillKeys[i]
        const currentSkill = currentDomain.skills[skillFriendlyName]

        LogHelper.info(`Setting up "${skillFriendlyName}" skill...`)

        await setupSkillsSettings(skillFriendlyName, currentSkill)
        await installNodejsSkillsPackages(skillFriendlyName, currentSkill)

        LogHelper.success(`"${skillFriendlyName}" skill set up`)
      }
    }

    LogHelper.success('Skills are set up')
  } catch (e) {
    LogHelper.error(`Failed to set up skills: ${e}`)
  }
}
