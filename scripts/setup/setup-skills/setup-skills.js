import path from 'node:path'

import { SkillDomainHelper } from '@/helpers/skill-domain-helper'

import { createSetupStatus } from '../setup-status'

import setupSkillsSettings from './setup-skills-settings'
import syncSkillDependencies from './sync-skill-dependencies'

/**
 * Browse skills and set them up
 */
export default async function () {
  const status = createSetupStatus('Setting up skills...').start()

  try {
    const skillNames = SkillDomainHelper.listAllSkillFoldersSync()

    for (const skillName of skillNames) {
      const descriptor = SkillDomainHelper.getSkillDescriptorSync(skillName, { includeDisabled: true })
      if (!descriptor || !SkillDomainHelper.isSkillInstalled(descriptor)) {
        continue
      }
      const currentSkill = await SkillDomainHelper.getNewSkillConfig(
        skillName,
        { includeDisabled: true }
      )
      const currentSkillPath = SkillDomainHelper.getNewSkillConfigPath(
        skillName,
        { includeDisabled: true }
      )

      if (!currentSkill || !currentSkillPath) {
        continue
      }

      const skillContext = {
        path: currentSkillPath ? path.dirname(currentSkillPath) : '',
        bridge: currentSkill.bridge
      }

      await setupSkillsSettings(skillName, skillContext)
      await syncSkillDependencies(skillName, skillContext)
    }

    status.succeed('Skills: ready')
  } catch (e) {
    status.fail('Failed to set up skills')
    throw e
  }
}
