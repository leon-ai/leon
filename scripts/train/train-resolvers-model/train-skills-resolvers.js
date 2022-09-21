import { composeFromPattern } from '@nlpjs/utils'

import { LOG } from '@/helpers/log'
import { getSkillDomains, getSkillConfig } from '@/helpers/skill-domain'

/**
 * Train skills resolvers
 */
export default (lang, nlp) =>
  new Promise(async (resolve) => {
    LOG.title('Skills resolvers training')

    const skillDomains = await getSkillDomains()

    skillDomains.forEach((currentDomain) => {
      const skillKeys = Object.keys(currentDomain.skills)

      skillKeys.forEach(async (skillName) => {
        const currentSkill = currentDomain.skills[skillName]
        const skillConfigData = await getSkillConfig({
          domain: currentDomain.name,
          skill: skillName,
          lang
        })

        if (skillConfigData != null) {
          const { resolvers } = skillConfigData

          if (resolvers != null) {
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
