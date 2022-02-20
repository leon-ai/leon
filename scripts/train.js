import { containerBootstrap } from '@nlpjs/core-loader'
import { Nlp } from '@nlpjs/nlp'
import { LangAll } from '@nlpjs/lang-all'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'

import log from '@/helpers/log'
import lang from '@/helpers/lang'
import domain from '@/helpers/domain'

dotenv.config()

/**
 * Training utterance samples script
 *
 * npm run train [en or fr]
 */
export default () => new Promise(async (resolve, reject) => {
  const modelFileName = 'server/src/data/leon-model.nlp'

  try {
    const container = await containerBootstrap()

    container.use(Nlp)
    container.use(LangAll)

    const nlp = container.get('nlp')
    const nluManager = container.get('nlu-manager')

    nluManager.settings.log = false
    nluManager.settings.trainByDomain = true
    nlp.settings.forceNER = true // https://github.com/axa-group/nlp.js/blob/master/examples/17-ner-nlg/index.js
    nlp.settings.calculateSentiment = true
    nlp.settings.modelFileName = modelFileName
    nlp.settings.threshold = 0.8

    const [domainKeys, domains] = await Promise.all([domain.list(), domain.getDomainsObj()])
    const shortLangs = lang.getShortLangs()

    for (let h = 0; h < shortLangs.length; h += 1) {
      const lang = shortLangs[h]

      nlp.addLanguage(lang)

      for (let i = 0; i < domainKeys.length; i += 1) {
        const currentDomain = domains[domainKeys[i]]
        const skillKeys = Object.keys(currentDomain.skills)

        log.info(`[${lang}] Training "${domainKeys[i]}" domain model...`)

        for (let j = 0; j < skillKeys.length; j += 1) {
          const { name: skillName } = currentDomain.skills[skillKeys[j]]
          const currentSkill = currentDomain.skills[skillKeys[j]]

          log.info(`[${lang}] Using "${skillKeys[j]}" skill utterance samples`)

          const nluFilePath = path.join(currentSkill.path, 'nlu', `${lang}.json`)

          if (fs.existsSync(nluFilePath)) {
            const { actions } = JSON.parse(fs.readFileSync(nluFilePath, 'utf8'))
            const actionsKeys = Object.keys(actions)

            for (let k = 0; k < actionsKeys.length; k += 1) {
              const actionName = actionsKeys[k]
              const actionObj = actions[actionName]
              const { utterance_samples: utteranceSamples } = actionObj

              nlp.assignDomain(lang, `${skillName}.${actionName}`, currentDomain.name)

              for (let l = 0; l < utteranceSamples.length; l += 1) {
                nlp.addDocument(lang, utteranceSamples[l], `${skillName}.${actionName}`)
              }
            }
          }
        }

        log.success(`[${lang}] "${domainKeys[i]}" domain trained`)
      }
    }

    try {
      await nlp.train()

      log.success(`NLP model saved in ${modelFileName}`)
      resolve()
    } catch (e) {
      log.error(`Failed to save NLP model: ${e}`)
      reject()
    }
  } catch (e) {
    log.error(e.message)
    reject(e)
  }
})
