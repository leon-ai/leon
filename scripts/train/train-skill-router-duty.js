import fs from 'node:fs'
import path from 'node:path'

import { LLM_SKILL_ROUTER_DUTY_SKILL_LIST_PATH } from '@/constants'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'

/**
 * Train skill router duty
 */
export default () =>
  new Promise(async (resolve, reject) => {
    try {
      const friendlyPrompts = await SkillDomainHelper.listSkillFriendlyPrompts()
      const formattedFriendlyPrompts = friendlyPrompts
        .map((friendlyPrompt, index) => {
          return `${index + 1}. ${friendlyPrompt}`
        })
        .join('\n')

      await fs.promises.mkdir(
        path.dirname(LLM_SKILL_ROUTER_DUTY_SKILL_LIST_PATH),
        { recursive: true }
      )
      await fs.promises.writeFile(
        LLM_SKILL_ROUTER_DUTY_SKILL_LIST_PATH,
        formattedFriendlyPrompts
      )

      resolve()
    } catch (e) {
      reject(e)
    }
  })
