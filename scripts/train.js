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
  const supportedActionTypes = ['dialog', 'logic']

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
    // nlp.settings.nlu = { useNoneFeature: true }
    nlp.settings.calculateSentiment = true
    nlp.settings.modelFileName = modelFileName
    nlp.settings.threshold = 0.8

    const [domainKeys, domains] = await Promise.all([domain.list(), domain.getDomainsObj()])
    const shortLangs = lang.getShortLangs()

    for (let h = 0; h < shortLangs.length; h += 1) {
      const lang = shortLangs[h]
      const resolversPath = path.join(process.cwd(), 'core/data', lang, 'resolvers')
      const resolverFiles = fs.readdirSync(resolversPath)

      nlp.addLanguage(lang)

      // Train resolvers
      for (let i = 0; i < resolverFiles.length; i += 1) {
        const resolverFileName = resolverFiles[i]
        const resolverPath = path.join(resolversPath, resolverFileName)
        const { name: resolverName, intents: resolverIntents } = JSON.parse(fs.readFileSync(resolverPath, 'utf8'))
        const intentKeys = Object.keys(resolverIntents)

        log.info(`[${lang}] Training "${resolverName}" resolver...`)

        for (let j = 0; j < intentKeys.length; j += 1) {
          const intentName = intentKeys[j]
          const intentObj = resolverIntents[intentName]

          nlp.assignDomain(lang, intentName, 'system')

          for (let k = 0; k < intentObj.utterance_samples.length; k += 1) {
            nlp.addDocument(lang, intentObj.utterance_samples[k], intentName)
          }
        }

        log.success(`[${lang}] "${resolverName}" resolver trained`)
      }

      // Train skills actions
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

              if (!actionObj.type || !supportedActionTypes.includes(actionObj.type)) {
                log.error(`This action type isn't supported: ${actionObj.type}`)
                process.exit(1)
              }

              nlp.assignDomain(lang, `${skillName}.${actionName}`, currentDomain.name)

              if (slots) {
                for (let l = 0; l < slots.length; l += 1) {
                  const slotObj = slots[l]

                  /**
                   * TODO: handle entity within questions such as "Where does {{ hero }} live?"
                   * https://github.com/axa-group/nlp.js/issues/328
                   * https://github.com/axa-group/nlp.js/issues/291
                   * https://github.com/axa-group/nlp.js/issues/307
                   */
                  if (slotObj.item.type === 'entity') {
                    nlp.slotManager
                      .addSlot(intent, `${slotObj.name}#${slotObj.item.name}`, true, { [lang]: slotObj.questions })
                  }
                  /* nlp.slotManager
                  .addSlot(intent, 'boolean', true, { [lang]: 'How many players?' }) */
                }
              }

              for (let l = 0; l < utteranceSamples?.length; l += 1) {
                nlp.addDocument(lang, utteranceSamples[l], intent)
              }

              // Train NLG if the action has a dialog type
              if (actionObj.type === 'dialog') {
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

              /**
               * TODO: load common entities not per action but globally?
               * TODO: as these entities are exposed to all actions
               */
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
