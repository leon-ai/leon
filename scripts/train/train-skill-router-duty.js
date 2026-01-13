import fs from 'node:fs'

import { LLM_SKILL_ROUTER_DUTY_SKILL_LIST_PATH } from '@/constants'
import { LogHelper } from '@/helpers/log-helper'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'

/**
 * Train skill router duty
 */
export default () =>
  new Promise(async (resolve, reject) => {
    LogHelper.title('Skill router duty training')

    try {
      const friendlyPrompts = await SkillDomainHelper.listSkillFriendlyPrompts()
      const formattedFriendlyPrompts = friendlyPrompts
        .map((friendlyPrompt, index) => {
          return `${index + 1}. ${friendlyPrompt}`
        })
        .join('\n')

      await fs.promises.writeFile(
        LLM_SKILL_ROUTER_DUTY_SKILL_LIST_PATH,
        formattedFriendlyPrompts
      )

      resolve()
    } catch (e) {
      LogHelper.error(`Failed to train skill router duty: ${e}`)
      reject(e)
    }
  })
