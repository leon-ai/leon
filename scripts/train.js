import { containerBootstrap } from '@nlpjs/core-loader'
import { Nlp } from '@nlpjs/nlp'
import { LangAll } from '@nlpjs/lang-all'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'

import log from '@/helpers/log'
import string from '@/helpers/string'
import lang from '@/helpers/lang'

dotenv.config()

/**
 * Training utterance samples script
 *
 * npm run train [en or fr]
 */
export default () => new Promise(async (resolve, reject) => {
  const packagesDir = 'packages'
  const modelFileName = 'server/src/data/leon-model.nlp'

  try {
    const container = await containerBootstrap()

    container.use(Nlp)
    container.use(LangAll)

    const nlp = container.get('nlp')
    const nluManager = container.get('nlu-manager')

    nluManager.settings.log = false
    nluManager.settings.trainByDomain = true
    nlp.settings.calculateSentiment = true
    nlp.settings.modelFileName = modelFileName
    nlp.settings.threshold = 0.8

    const shortLangs = lang.getShortLangs()

    for (let h = 0; h < shortLangs.length; h += 1) {
      const lang = shortLangs[h]

      nlp.addLanguage(lang)

      const packages = fs.readdirSync(packagesDir)
        .filter((entity) => fs.statSync(path.join(packagesDir, entity)).isDirectory())
      let utteranceSamplesObj = { }

      for (let i = 0; i < packages.length; i += 1) {
        log.info(`[${lang}] Training "${string.ucfirst(packages[i])}" package modules utterance samples...`)

        utteranceSamplesObj = JSON.parse(fs.readFileSync(`${packagesDir}/${packages[i]}/data/expressions/${lang}.json`, 'utf8'))

        const modules = Object.keys(utteranceSamplesObj)
        for (let j = 0; j < modules.length; j += 1) {
          const module = modules[j]
          const actions = Object.keys(utteranceSamplesObj[module])

          for (let k = 0; k < actions.length; k += 1) {
            const action = actions[k]
            const exprs = utteranceSamplesObj[module][action].utterance_samples

            nlp.assignDomain(lang, `${module}.${action}`, packages[i])

            for (let l = 0; l < exprs.length; l += 1) {
              nlp.addDocument(lang, exprs[l], `${module}.${action}`)
            }
          }

          log.success(`[${lang}] "${string.ucfirst(module)}" module utterance samples trained`)
        }
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
