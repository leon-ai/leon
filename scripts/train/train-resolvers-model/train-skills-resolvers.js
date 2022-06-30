import path from 'path'
import fs from 'fs'

import log from '@/helpers/log'
import domain from '@/helpers/domain'
import json from '@/helpers/json'

/**
 * Train skills resolvers
 */
export default (lang, nlp) => new Promise(async (resolve) => {
  log.title('Skills resolvers training')

  const [domainKeys, domains] = await Promise.all([domain.list(), domain.getDomainsObj()])

  domainKeys.forEach((domainName) => {
    const currentDomain = domains[domainName]
    const skillKeys = Object.keys(currentDomain.skills)

    skillKeys.forEach(async (skillName) => {
      const currentSkill = currentDomain.skills[skillName]
      const nluFilePath = path.join(currentSkill.path, 'nlu', `${lang}.json`)

      if (fs.existsSync(nluFilePath)) {
        const { resolvers } = await json.loadNluData(nluFilePath, lang)

        if (resolvers) {
          const resolversKeys = Object.keys(resolvers)

          resolversKeys.forEach((resolverName) => {
            const resolver = resolvers[resolverName]
            const intentKeys = Object.keys(resolver.intents)

            log.info(`[${lang}] Training "${resolverName}" resolver...`)

            intentKeys.forEach((intentName) => {
              const intent = `resolver.${currentSkill.name}.${resolverName}.${intentName}`
              const intentObj = resolver.intents[intentName]

              nlp.assignDomain(lang, intent, currentDomain.name)

              intentObj.utterance_samples.forEach((utteranceSample) => {
                nlp.addDocument(lang, utteranceSample, intent)
              })
            })

            log.success(`[${lang}] "${resolverName}" resolver trained`)
          })
        }
      }
    })
  })

  resolve()
})
