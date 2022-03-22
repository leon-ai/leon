import { containerBootstrap } from '@nlpjs/core-loader'
import { Nlp } from '@nlpjs/nlp'
import { LangAll } from '@nlpjs/lang-all'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'

import log from '@/helpers/log'
import lang from '@/helpers/lang'
import domain from '@/helpers/domain'
import string from '@/helpers/string'
import json from '@/helpers/json'

dotenv.config()

/**
 * Training utterance samples script
 *
 * npm run train [en or fr]
 */
export default () => new Promise(async (resolve, reject) => {
  const modelFileName = 'core/data/leon-model.nlp'

  try {
    const container = await containerBootstrap()

    container.use(Nlp)
    container.use(LangAll)

    const nlp = container.get('nlp')
    const nluManager = container.get('nlu-manager')
    // const slotManager = container.get('SlotManager')

    nluManager.settings.log = false
    nluManager.settings.trainByDomain = true
    // slotManager.settings.
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

          log.info(`[${lang}] Using "${skillKeys[j]}" skill NLU data`)

          const nluFilePath = path.join(currentSkill.path, 'nlu', `${lang}.json`)

          if (fs.existsSync(nluFilePath)) {
            const {
              actions,
              entities,
              variables
            } = await json.loadNluData(nluFilePath, lang) // eslint-disable-line no-await-in-loop
            const actionsKeys = Object.keys(actions)

            for (let k = 0; k < actionsKeys.length; k += 1) {
              const actionName = actionsKeys[k]
              const actionObj = actions[actionName]
              const intent = `${skillName}.${actionName}`
              const { utterance_samples: utteranceSamples, answers, slots } = actionObj

              nlp.assignDomain(lang, `${skillName}.${actionName}`, currentDomain.name)

              /**
               * TODO:
               * 1. [OK] Merge person, location and organization to the
               * NER before processing NLU (cf. line 210 in nlu.js)
               * 2. [OK] Grab intents with slots
               * 3. [OK] .addSlot() as per the slots config
               * 4. Handle random questions picking
               * 5. Train resolvers (affirm_deny: boolean value)
               * 6. Map resolvers to skill actions
               * 7. Utterance source type to get raw input from utterance
               */
              if (slots) {
                for (let l = 0; l < slots.length; l += 1) {
                  const slotObj = slots[l]

                  /**
                   * TODO: handle entity within questions such as "Where does {{ hero }} live?"
                   * https://github.com/axa-group/nlp.js/issues/328
                   * https://github.com/axa-group/nlp.js/issues/291
                   * https://github.com/axa-group/nlp.js/issues/307
                   */
                  if (slotObj.source.type === 'entity') {
                    nlp.slotManager
                      .addSlot(intent, slotObj.source.name, true, { [lang]: slotObj.questions })
                  }
                  /* nlp.slotManager
                  .addSlot(intent, 'boolean', true, { [lang]: 'How many players?' }) */
                }
              }

              for (let l = 0; l < utteranceSamples?.length; l += 1) {
                nlp.addDocument(lang, utteranceSamples[l], intent)
              }

              // Train NLG if the skill has a dialog type
              if (currentSkill.type === 'dialog') {
                const variablesObj = { }

                // Dynamic variables binding if any variable is declared
                if (variables) {
                  const variableKeys = Object.keys(variables)

                  for (let l = 0; l < variableKeys.length; l += 1) {
                    const key = variableKeys[l]

                    variablesObj[`%${key}%`] = variables[variableKeys[l]]
                  }
                }

                for (let l = 0; l < answers?.length; l += 1) {
                  const variableKeys = Object.keys(variablesObj)
                  if (variableKeys.length > 0) {
                    answers[l] = string.pnr(answers[l], variablesObj)
                  }

                  nlp.addAnswer(lang, `${skillName}.${actionName}`, answers[l])
                }
              }

              // Add entities annotations (@...)
              if (entities) {
                const newEntitiesObj = { }
                const entityKeys = Object.keys(entities)

                for (let l = 0; l < entityKeys.length; l += 1) {
                  const entity = entities[entityKeys[l]]
                  const optionKeys = Object.keys(entity.options)
                  const options = { }

                  for (let m = 0; m < optionKeys.length; m += 1) {
                    const option = entity.options[optionKeys[m]]

                    options[optionKeys[m]] = option.synonyms
                  }

                  newEntitiesObj[entityKeys[l]] = { options }
                }

                nlp.addEntities(newEntitiesObj, lang)
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
