import { NlpManager } from 'node-nlp'
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'

import log from '@/helpers/log'
import string from '@/helpers/string'

import { langs } from '../core/langs.json'

dotenv.config()

/**
 * Training script
 *
 * npm run train expressions
 * npm run train expressions:en
 */
export default () => new Promise(async (resolve, reject) => {
  const { argv } = process
  const packagesDir = 'packages'
  const expressionsClassifier = 'server/src/data/expressions/classifier.json'
  let type = (argv[2]) ? argv[2].toLowerCase() : 'expressions'
  let lang = ''

  if (type.indexOf(':') !== -1) {
    [type, lang] = type.split(':')
  } else {
    lang = langs[process.env.LEON_LANG].short.toLowerCase().substr(0, 2)
  }

  try {
    if (type === 'expressions') {
      const settings = {
        languages: lang !== 'en' ? lang : ['en'],
        modelFileName: expressionsClassifier,
        nlu: { log: false }
      }

      const manager = new NlpManager(settings)
      const packages = fs.readdirSync(packagesDir)
        .filter(entity =>
          fs.statSync(path.join(packagesDir, entity)).isDirectory())
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

            manager.assignDomain(lang, `${module}.${action}`, packages[i])

            for (let l = 0; l < exprs.length; l += 1) {
              manager.addDocument(lang, exprs[l], `${module}.${action}`)
            }
          }

          log.success(`"${string.ucfirst(module)}" module expressions trained`)
        }
      }

      await manager.train()

      fs.writeFile(expressionsClassifier, manager.export(true), (err) => {
        if (err) {
          log.error(`Failed to save the classifier: ${err}`)
          reject()
        } else {
          log.success('Classifier saved in server/src/data/expressions/classifier.json')
          resolve()
        }
      })
    } else {
      log.error(`"${type}" training type is unknown. Try "npm run train expressions"`)
      reject()
    }
  } catch (e) {
    log.error(e.message)
    reject(e)
  }
})
