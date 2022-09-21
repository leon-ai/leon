import path from 'path'
import fs from 'fs'
import { composeFromPattern } from '@nlpjs/utils'

import { LOG } from '@/helpers/log'
import { SKILL_DOMAIN } from '@/helpers/skill-domain'

/**
 * Train skills resolvers
 */
export default (lang, nlp) =>
  new Promise(async (resolve) => {
    LOG.title('Skills resolvers training')

    const skillDomains = await SKILL_DOMAIN.getSkillDomains()

    skillDomains.forEach((currentDomain) => {
      const skillKeys = Object.keys(currentDomain.skills)

      skillKeys.forEach(async (skillName) => {
        const currentSkill = currentDomain.skills[skillName]
        const configFilePath = path.join(
          currentSkill.path,
          'config',
          `${lang}.json`
        )

        if (fs.existsSync(configFilePath)) {
          const { resolvers } = await SKILL_DOMAIN.getSkillConfig(
            configFilePath,
            lang
          )

          if (resolvers) {
            const resolversKeys = Object.keys(resolvers)

            resolversKeys.forEach((resolverName) => {
              const resolver = resolvers[resolverName]
              const intentKeys = Object.keys(resolver.intents)

              LOG.info(
                `[${lang}] Training ${skillName} "${resolverName}" resolver...`
              )

              intentKeys.forEach((intentName) => {
                const intent = `resolver.${currentSkill.name}.${resolverName}.${intentName}`
                const intentObj = resolver.intents[intentName]

                nlp.assignDomain(lang, intent, currentDomain.name)

                intentObj.utterance_samples.forEach((utteranceSample) => {
                  // Achieve Cartesian training
                  const utteranceAlternatives =
                    composeFromPattern(utteranceSample)

                  utteranceAlternatives.forEach((utteranceAlternative) => {
                    nlp.addDocument(lang, utteranceAlternative, intent)
                  })
                })
              })

              LOG.success(
                `[${lang}] ${skillName} "${resolverName}" resolver trained`
              )
            })
          }
        }
      })
    })

    resolve()
  })
