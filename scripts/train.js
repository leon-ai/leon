import { dockStart } from '@nlpjs/basic'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'

import log from '@/helpers/log'
import string from '@/helpers/string'

import { langs } from '@@/core/langs.json'

dotenv.config()

/**
 * Training expressions script
 *
 * npm run train [en or fr]
 */
export default () => new Promise(async (resolve, reject) => {
  const { argv } = process
  const packagesDir = 'packages'
  const modelFileName = 'server/src/data/leon-model.nlp'
  const lang = argv[2]
    ? argv[2].toLowerCase()
    : langs[process.env.LEON_LANG].short.toLowerCase().substr(0, 2)

  try {
    const dock = await dockStart({ use: ['Basic'] })

    const nlp = dock.get('nlp')
    nlp.settings.modelFileName = modelFileName
    nlp.settings.threshold = 0.8

    nlp.addLanguage(lang)

    const packages = fs.readdirSync(packagesDir)
      .filter((entity) => fs.statSync(path.join(packagesDir, entity)).isDirectory())
    let expressionsObj = { }

    for (let i = 0; i < packages.length; i += 1) {
      log.info(`Training "${string.ucfirst(packages[i])}" package modules expressions...`)

      expressionsObj = JSON.parse(fs.readFileSync(`${packagesDir}/${packages[i]}/data/expressions/${lang}.json`, 'utf8'))

      const modules = Object.keys(expressionsObj)
      for (let j = 0; j < modules.length; j += 1) {
        const module = modules[j]
        const actions = Object.keys(expressionsObj[module])

        for (let k = 0; k < actions.length; k += 1) {
          const action = actions[k]
          const exprs = expressionsObj[module][action].expressions

          nlp.assignDomain(lang, `${module}.${action}`, packages[i])

          for (let l = 0; l < exprs.length; l += 1) {
            nlp.addDocument(lang, exprs[l], `${module}.${action}`)
          }
        }

        log.success(`"${string.ucfirst(module)}" module expressions trained`)
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
